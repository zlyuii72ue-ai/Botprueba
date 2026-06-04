const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('System Status: Online');
}).listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID
};

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}
const FILE_PATH = path.join(DATA_DIR, 'storage.json');

function loadData() {
    try {
        if (!fs.existsSync(FILE_PATH)) {
            const initial = { staff: {}, logs: [], channels: {} };
            fs.writeFileSync(FILE_PATH, JSON.stringify(initial, null, 4));
            return initial;
        }
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'));
    } catch (error) {
        console.error('Data loading failure:', error);
        return { staff: {}, logs: [], channels: {} };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 4));
    } catch (error) {
        console.error('Data saving failure:', error);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('Ranking de rendimiento del personal de staff'),
    new SlashCommandBuilder()
        .setName('evidencias')
        .setDescription('Historial de registros de un miembro específico')
        .addUserOption(option => option.setName('usuario').setDescription('Usuario a consultar').setRequired(false)),
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configuracion de canales operativos')
        .addStringOption(option => 
            option.setName('tipo')
                .setDescription('Categoria del canal')
                .setRequired(true)
                .addChoices(
                    { name: 'Baneos', value: 'baneos' },
                    { name: 'Muteos', value: 'muteos' },
                    { name: 'Revives', value: 'revives' }
                ))
        .addChannelOption(option => option.setName('canal').setDescription('Canal de destino').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
    } catch (error) {
        console.error('Command registration error:', error);
    }
})();

client.once('ready', () => {
    console.log(`Authenticated as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const data = loadData();
    const type = data.channels?.[message.channel.id];
    if (!type) return;

    const content = message.content;
    const format = /^Nick:\s*(.+)\nMotivo:\s*(.+)\nTiempo:\s*(.+)\nPruebas:\s*(.+)$/i;

    if (!format.test(content)) {
        try {
            if (message.deletable) await message.delete();
            const warning = await message.channel.send(`Formato incorrecto detectado de parte de ${message.author.username}. Use la estructura obligatoria de la plantilla:\n\`\`\`\nNick:\nMotivo:\nTiempo:\nPruebas:\n\`\`\``);
            setTimeout(() => warning.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error('Format enforcement error:', error);
        }
        return;
    }

    const matches = content.match(format);
    const nick = matches[1];
    const motivo = matches[2];
    const tiempo = matches[3];
    let pruebas = matches[4];

    if (message.attachments.size > 0) {
        const attachments = message.attachments.map(a => a.url).join('\n');
        pruebas += `\n${attachments}`;
    }

    try {
        if (message.deletable) await message.delete();

        const colorMap = {
            baneos: '#2f3171', // Azul oscuro tirando a morado
            muteos: '#4b306b', // Morado oscuro
            revives: '#1d4ed8'  // Azul cobalto
        };

        const embed = new EmbedBuilder()
            .setTitle(`Registro: ${type.toUpperCase()}`)
            .setColor(colorMap[type] || '#2b2d31')
            .addFields(
                { name: 'Personal Responsable', value: `${message.author} (${message.author.id})`, inline: false },
                { name: 'Nick de Usuario', value: `\`${nick}\``, inline: true },
                { name: 'Duracion', value: `\`${tiempo}\``, inline: true },
                { name: 'Motivo', value: motivo, inline: false },
                { name: 'Evidencias', value: pruebas, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'iLoveTungtung_' });

        const imageRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i;
        const imgMatch = pruebas.match(imageRegex);
        if (imgMatch) {
            embed.setImage(imgMatch[1]);
        }

        await message.channel.send({ embeds: [embed] });

        if (!data.staff[message.author.id]) {
            data.staff[message.author.id] = { baneos: 0, muteos: 0, revives: 0 };
        }

        data.staff[message.author.id][type] += 1;
        data.logs.push({
            user_id: message.author.id,
            type: type,
            content: `Nick: ${nick}\nMotivo: ${motivo}\nTiempo: ${tiempo}\nPruebas: ${pruebas}`,
            date: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });

        saveData(data);
    } catch (error) {
        console.error('Log creation error:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'setup') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Permisos insuficientes: Se requiere Administrador.', ephemeral: true });
        }

        const tipo = interaction.options.getString('tipo');
        const canal = interaction.options.getChannel('canal');

        const data = loadData();
        data.channels[canal.id] = tipo;
        saveData(data);

        return interaction.reply({ content: `Configuracion guardada: ${canal} registrado para [${tipo}].`, ephemeral: true });
    }

    await interaction.deferReply().catch(() => {});
    const data = loadData();

    if (commandName === 'top') {
        const ranking = Object.keys(data.staff)
            .map(id => ({
                id,
                ...data.staff[id],
                total: (data.staff[id].baneos || 0) + (data.staff[id].muteos || 0) + (data.staff[id].revives || 0)
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

        if (ranking.length === 0) {
            return interaction.editReply({ content: 'No existen registros analiticos almacenados.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('Ranking de Rendimiento - Personal de Staff')
            .setColor('#3b82f6') // Azul
            .setTimestamp()
            .setFooter({ text: 'iLoveTungtung_' });

        let description = '';
        ranking.forEach((user, idx) => {
            description += `**[#${idx + 1}]** <@${user.id}>\nTotal: \`${user.total}\` | Baneos: \`${user.baneos}\` | Muteos: \`${user.muteos}\` | Revives: \`${user.revives}\`\n\n`;
        });

        embed.setDescription(description);
        return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'evidencias') {
        const target = interaction.options.getUser('usuario') || interaction.user;
        const userLogs = data.logs
            .filter(log => log.user_id === target.id)
            .slice(-5)
            .reverse();

        if (userLogs.length === 0) {
            return interaction.editReply({ content: `El usuario analizado no posee historial en el sistema.` });
        }

        const embed = new EmbedBuilder()
            .setTitle(`Historial de Registros - ${target.username}`)
            .setColor('#6d28d9') // Morado
            .setFooter({ text: 'iLoveTungtung_' });

        userLogs.forEach((log, index) => {
            const shortened = log.content.length > 250 ? log.content.substring(0, 250) + '...' : log.content;
            embed.addFields({
                name: `[${index + 1}] Tipo: ${log.type.toUpperCase()} | ${log.date}`,
                value: `\`\`\`\n${shortened}\n\`\`\``
            });
        });

        return interaction.editReply({ embeds: [embed] });
    }
});

client.login(CONFIG.TOKEN);
