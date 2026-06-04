const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('System Status: Operational');
}).listen(process.env.PORT || 3000);

process.on('uncaughtException', (error) => {
    console.error('Captured Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
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
    CLIENT_ID: process.env.CLIENT_ID
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
        return { staff: {}, logs: [], channels: {} };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 4));
    } catch (error) {
        console.error('Storage update failure:', error);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('Ranking de rendimiento del personal de staff'),
    new SlashCommandBuilder()
        .setName('evidencias')
        .setDescription('Historial de registros de un miembro especifico')
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

client.once('ready', async () => {
    console.log(`Authenticated as ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
        console.log('Global application commands successfully synchronized.');
    } catch (error) {
        console.error('Command synchronization deployment failure:', error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const data = loadData();
    const type = data.channels?.[message.channel.id];
    if (!type) return;

    const content = message.content.trim();
    
    const nickRegex = /^[^\n]*Nick:\s*([^\n]+)/im;
    const motivoRegex = /^[^\n]*Motivo:\s*([^\n]+)/im;
    const tiempoRegex = /^[^\n]*Tiempo:\s*([^\n]+)/im;
    const pruebasRegex = /^[^\n]*Pruebas:\s*([\s\S]+)/im;

    const matchNick = content.match(nickRegex);
    const matchMotivo = content.match(motivoRegex);
    const matchTiempo = content.match(tiempoRegex);
    const matchPruebas = content.match(pruebasRegex);

    if (!matchNick || !matchMotivo || !matchTiempo || !matchPruebas) {
        try {
            if (message.deletable) await message.delete();
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('Error de Formato')
                .setDescription(`Estructura incorrecta de parte de ${message.author.username}.\n\nUse la plantilla exacta obligatoria:`)
                .addFields({ name: 'Plantilla Requerida', value: '\`\`\`\nNick:\nMotivo:\nTiempo:\nPruebas:\n\`\`\`' })
                .setColor('#2f3171')
                .setTimestamp();

            const warning = await message.channel.send({ embeds: [errorEmbed] });
            setTimeout(() => warning.delete().catch(() => {}), 6000);
        } catch (error) {
            console.error('Format moderation exception:', error);
        }
        return;
    }

    const nick = matchNick[1].trim();
    const motivo = matchMotivo[1].trim();
    const tiempo = matchTiempo[1].trim();
    let pruebas = matchPruebas[1].trim();

    if (message.attachments.size > 0) {
        const attachments = message.attachments.map(a => a.url).join('\n');
        pruebas += `\n${attachments}`;
    }

    try {
        if (message.deletable) await message.delete();

        const colorMap = {
            baneos: '#2f3171',
            muteos: '#4b306b',
            revives: '#1d4ed8'
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
        console.error('Data logging process failure:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'setup') {
        if (!interaction.member.permissions.has('Administrator')) {
            const noPerms = new EmbedBuilder()
                .setTitle('Acceso Denegado')
                .setDescription('Permisos insuficientes: Se requiere Administrador.')
                .setColor('#2f3171');
            return interaction.reply({ embeds: [noPerms], ephemeral: true });
        }

        const tipo = interaction.options.getString('tipo');
        const canal = interaction.options.getChannel('canal');

        const data = loadData();
        data.channels[canal.id] = tipo;
        saveData(data);

        const setupEmbed = new EmbedBuilder()
            .setTitle('Configuracion Guardada')
            .setDescription(`El canal ${canal} ha sido registrado para [${tipo}].`)
            .setColor('#4b306b');
        return interaction.reply({ embeds: [setupEmbed], ephemeral: true });
    }

    await interaction.deferReply().catch(() => {});
    const data = loadData();

    if (commandName === 'top') {
        const ranking = Object.keys(data.staff)
            .map(id => ({
                id,
                baneos: data.staff[id].baneos || 0,
                muteos: data.staff[id].muteos || 0,
                revives: data.staff[id].revives || 0,
                total: (data.staff[id].baneos || 0) + (data.staff[id].muteos || 0) + (data.staff[id].revives || 0)
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

        const ahora = new Date();
        const diaSemana = ahora.getDay();
        const diferencia = ahora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1);
        const lunesActual = new Date(ahora.setDate(diferencia));
        const fechaFormateada = `${lunesActual.getDate()}/${lunesActual.getMonth() + 1}/${lunesActual.getFullYear()}`;

        const embed = new EmbedBuilder()
            .setTitle('Ranking de Rendimiento - Personal de Staff')
            .setColor('#2f3171')
            .setTimestamp()
            .setFooter({ text: 'iLoveTungtung_' });

        if (ranking.length === 0) {
            embed.setDescription(`📅 Semana: ${fechaFormateada}\n\nNo existen registros analiticos almacenados en la base de datos actualmente.`);
            return interaction.editReply({ embeds: [embed] });
        }

        let description = `📅 Semana: ${fechaFormateada}\n\n`;
        
        ranking.forEach((user, idx) => {
            let prefijo = `**${idx + 1}.**`;
            if (idx === 0) prefijo = '🥇';
            if (idx === 1) prefijo = '🥈';
            if (idx === 2) prefijo = '🥉';

            description += `${prefijo} <@${user.id}>: 🔨${user.baneos} | 🔉${user.muteos} | 💚${user.revives} | ⏱️0h 0m 0s\n`;
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

        const embed = new EmbedBuilder()
            .setTitle(`Historial de Registros - ${target.username}`)
            .setColor('#4b306b')
            .setFooter({ text: 'iLoveTungtung_' });

        if (userLogs.length === 0) {
            embed.setDescription(`El usuario <@${target.id}> no posee historial de actividades en el sistema.`);
            return interaction.editReply({ embeds: [embed] });
        }

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
        
