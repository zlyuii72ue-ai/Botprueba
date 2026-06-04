const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

// --- SERVIDOR WEB PARA EVITAR QUE RAILWAY APAGUE EL BOT ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('iLoveTungtung_ activo en producción');
}).listen(process.env.PORT || 3000, () => {
    console.log('Servidor de mantenimiento web iniciado de forma correcta.');
});

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

const FILE_PATH = path.join(__dirname, 'database.json');

function loadData() {
    if (!fs.existsSync(FILE_PATH)) {
        const defaultData = { staff_data: {}, logs: [], channels: {} };
        fs.writeFileSync(FILE_PATH, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    try {
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'));
    } catch (e) {
        return { staff_data: {}, logs: [], channels: {} };
    }
}

function saveData(data) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

const commands = [
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('Muestra el ranking de actividad del staff'),
    new SlashCommandBuilder()
        .setName('evidencias')
        .setDescription('Muestra el historial de registros de un miembro')
        .addUserOption(option => option.setName('usuario').setDescription('Miembro a consultar').setRequired(false)),
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configura los canales de registro')
        .addStringOption(option => 
            option.setName('tipo')
                .setDescription('Tipo de registro')
                .setRequired(true)
                .addChoices(
                    { name: 'Baneos', value: 'baneos' },
                    { name: 'Muteos', value: 'muteos' },
                    { name: 'Revives', value: 'revives' }
                ))
        .addChannelOption(option => option.setName('canal').setDescription('Canal objetivo').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
    } catch (error) {
        console.error('Error cargando comandos:', error);
    }
})();

client.once('ready', () => {
    console.log(`Sesión iniciada de forma exitosa: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const data = loadData();
    const activeChannels = data.channels || {};
    const type = activeChannels[message.channel.id];

    if (!type) return;

    const rawContent = message.content;
    const formatCheck = /^Nick:\s*(.+)\nMotivo:\s*(.+)\nTiempo:\s*(.+)\nPruebas:\s*(.+)$/i;

    if (!formatCheck.test(rawContent)) {
        try {
            await message.delete().catch(() => {});
            const warning = await message.channel.send(`⚠️ **${message.author.username}**, formato incorrecto. Utiliza la estructura obligatoria:\n\`\`\`\nNick:\nMotivo:\nTiempo:\nPruebas:\n\`\`\``);
            setTimeout(() => warning.delete().catch(() => {}), 6000);
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const matches = rawContent.match(formatCheck);
    const nick = matches[1];
    const motivo = matches[2];
    const tiempo = matches[3];
    let pruebas = matches[4];

    if (message.attachments.size > 0) {
        const attachmentUrls = message.attachments.map(a => a.url).join('\n');
        pruebas += `\n${attachmentUrls}`;
    }

    try {
        await message.delete().catch(() => {});

        const badge = type === 'baneos' ? '✖️' : type === 'muteos' ? '🔇' : '💗';
        const color = type === 'baneos' ? '#ff4d4d' : type === 'muteos' ? '#ff9933' : '#ff66b2';

        const embedRegistro = new EmbedBuilder()
            .setTitle(`${badge} Nuevo Registro: ${type.toUpperCase()}`)
            .setColor(color)
            .addFields(
                { name: '👤 Staff Responsable', value: `<@${message.author.id}>`, inline: false },
                { name: '🆔 Nick del Usuario', value: `\`${nick}\``, inline: true },
                { name: '⏳ Tiempo / Duración', value: `\`${tiempo}\``, inline: true },
                { name: '📝 Motivo', value: motivo, inline: false },
                { name: '🔗 Evidencias / Pruebas', value: pruebas, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'iLoveTungtung_' });

        const imageRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i;
        const hasImage = pruebas.match(imageRegex);
        if (hasImage) {
            embedRegistro.setImage(hasImage[1]);
        }

        await message.channel.send({ embeds: [embedRegistro] });

        if (!data.staff_data[message.author.id]) {
            data.staff_data[message.author.id] = { baneos: 0, muteos: 0, revives: 0 };
        }

        data.staff_data[message.author.id][type] += 1;

        data.logs.push({
            user_id: message.author.id,
            type: type,
            content: `Nick: ${nick}\nMotivo: ${motivo}\nTiempo: ${tiempo}\nPruebas: ${pruebas}`,
            created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });

        saveData(data);
    } catch (err) {
        console.error('Error procesando registro:', err);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'setup') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: 'Acceso denegado: Se requieren permisos de Administrador.', ephemeral: true });
        }
        
        const tipo = interaction.options.getString('tipo');
        const canal = interaction.options.getChannel('canal');

        const data = loadData();
        data.channels[canal.id] = tipo;
        saveData(data);

        return interaction.reply({ content: `Canal para **${tipo}** asignado correctamente en ${canal}.`, ephemeral: true });
    }

    await interaction.deferReply().catch(() => {});
    const data = loadData();

    if (commandName === 'top') {
        const sortedStaff = Object.keys(data.staff_data)
            .map(id => ({
                id,
                ...data.staff_data[id],
                total: (data.staff_data[id].baneos || 0) + (data.staff_data[id].muteos || 0) + (data.staff_data[id].revives || 0)
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

        if (sortedStaff.length === 0) {
            return interaction.editReply({ content: 'No se encontraron registros en el sistema.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 TOP 10 ACTIVIDAD STAFF 🏆')
            .setColor('#D4AF37')
            .setTimestamp()
            .setFooter({ text: 'iLoveTungtung_' });

        let list = '';
        sortedStaff.forEach((row, i) => {
            list += `**#${i + 1}** <@${row.id}> — Total: \`${row.total}\`\n✖️ \`${row.baneos}\` | 🔇 \`${row.muteos}\` | 💗 \`${row.revives}\`\n\n`;
        });

        embed.setDescription(list);
        return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'evidencias') {
        const target = interaction.options.getUser('usuario') || interaction.user;
        const userLogs = data.logs
            .filter(log => log.user_id === target.id)
            .slice(-5)
            .reverse();

        if (userLogs.length === 0) {
            return interaction.editReply({ content: `El usuario <@${target.id}> no registra evidencias.` });
        }

        const embed = new EmbedBuilder()
            .setTitle(`Registros Recientes — ${target.username}`)
            .setColor('#2B2D31')
            .setFooter({ text: 'iLoveTungtung_' });

        userLogs.forEach((row, index) => {
            const badge = row.type === 'baneos' ? '✖️' : row.type === 'muteos' ? '🔇' : '💗';
            const trimmedText = row.content.length > 250 ? row.content.substring(0, 250) + '...' : row.content;
            
            embed.addFields({
                name: `[${index + 1}] Acción: ${badge} ${row.type.toUpperCase()}`,
                value: `\`\`\`\n${trimmedText}\n\`\`\`*Fecha: ${row.created_at}*`
            });
        });

        return interaction.editReply({ embeds: [embed] });
    }
});

client.login(CONFIG.TOKEN);
