const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Operational');
}).listen(process.env.PORT || 3000);

process.on('uncaughtException', (error) => console.error('Exception:', error));
process.on('unhandledRejection', (reason) => console.error('Rejection:', reason));

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
});

const CONFIG = { TOKEN: process.env.DISCORD_TOKEN, CLIENT_ID: process.env.CLIENT_ID };
const FILE_PATH = path.join('/tmp', 'storage.json');

function loadData() {
    try {
        if (!fs.existsSync(FILE_PATH)) {
            const initial = { staff: {}, logs: [], channels: {} };
            fs.writeFileSync(FILE_PATH, JSON.stringify(initial, null, 4));
            return initial;
        }
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'));
    } catch { return { staff: {}, logs: [], channels: {} }; }
}

function saveData(data) {
    try { fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 4)); } catch (e) { console.error(e); }
}

const commands = [
    new SlashCommandBuilder().setName('top').setDescription('Ranking de rendimiento del personal de staff'),
    new SlashCommandBuilder().setName('evidencias').setDescription('Historial de registros de un miembro especifico')
        .addUserOption(option => option.setName('usuario').setDescription('Usuario a consultar').setRequired(false)),
    new SlashCommandBuilder().setName('setup').setDescription('Configuracion de canales operativos')
        .addStringOption(option => option.setName('tipo').setDescription('Categoria').setRequired(true)
            .addChoices({ name: 'Baneos', value: 'baneos' }, { name: 'Muteos', value: 'muteos' }, { name: 'Revives', value: 'revives' }))
        .addChannelOption(option => option.setName('canal').setDescription('Canal de destino').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

client.once('ready', async () => {
    try { await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
});

client.on('messageCreate', async (message) => {
    if (!message || !message.author || message.author.bot || !message.guild) return;

    try {
        const data = loadData();
        const type = data.channels?.[message.channel.id];
        if (!type) return;

        const content = message.content ? message.content.trim() : '';
        const lines = content.split('\n');
        let nick = '', motivo = '', tiempo = '', pruebasTexto = '';

        lines.forEach(line => {
            const lower = line.toLowerCase();
            if (lower.startsWith('nick:')) nick = line.substring(5).trim();
            else if (lower.startsWith('motivo:')) motivo = line.substring(7).trim();
            else if (lower.startsWith('tiempo:')) tiempo = line.substring(7).trim();
            else if (lower.startsWith('pruebas:')) pruebasTexto = line.substring(8).trim();
        });

        const canDelete = message.guild?.members?.me?.permissionsIn(message.channel).has('ManageMessages');

        if (!nick || !motivo || !tiempo) {
            if (canDelete && message.deletable) await message.delete().catch(() => {});
            const errorEmbed = new EmbedBuilder()
                .setTitle('⚠️ Formato Incorrecto')
                .setDescription(`Estructura errónea enviada por ${message.author.username}.\n\nFormato obligatorio:\n\`\`\`\nNick:\nMotivo:\nTiempo:\n\`\`\``)
                .setColor('#6a1b9a')
                .setTimestamp();
            const warning = await message.channel.send({ embeds: [errorEmbed] });
            setTimeout(() => warning.delete().catch(() => {}), 6000);
            return;
        }

        let linksEncontrados = [];
        if (pruebasTexto) {
            const linkRegex = /(https?:\/\/[^\s]+)/gi;
            linksEncontrados = pruebasTexto.match(linkRegex) || [];
        }

        const archivosParaEnviar = [];
        if (message.attachments && message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment && attachment.url) {
                    archivosParaEnviar.push(new AttachmentBuilder(attachment.url, { name: attachment.name || 'evidencia.png' }));
                }
            });
        }

        if (!data.staff[message.author.id]) data.staff[message.author.id] = { baneos: 0, muteos: 0, revives: 0 };
        data.staff[message.author.id][type] = (data.staff[message.author.id][type] || 0) + 1;
        const totalSancionesTipo = data.staff[message.author.id][type];

        const titleMap = { baneos: '🏮 BAN REGISTRADO', muteos: '🎙️ MUTE REGISTRADO', revives: '💫 REVIVE REGISTRADO' };
        const colorMap = { baneos: '#6a1b9a', muteos: '#7b1fa2', revives: '#8e24aa' };
        const fieldTotalMap = { baneos: 'Total Bans', muteos: 'Total Mutes', revives: 'Total Revives' };

        const embed = new EmbedBuilder()
            .setTitle(titleMap[type] || 'REGISTRO')
            .setColor(colorMap[type] || '#7b1fa2')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }) || null)
            .addFields(
                { name: 'Nick Sancionado', value: nick, inline: false },
                { name: 'Motivo', value: motivo, inline: false },
                { name: 'Duracion', value: tiempo, inline: false },
                { name: 'Staff', value: `${message.author}`, inline: false },
                { name: fieldTotalMap[type] || 'Total', value: String(totalSancionesTipo), inline: false }
            )
            .setTimestamp();

        if (pruebasTexto) embed.addFields({ name: 'Evidencias', value: pruebasTexto, inline: false });

        await message.channel.send({ embeds: [embed] });

        if (linksEncontrados.length > 0) {
            await message.channel.send({ content: linksEncontrados.join('\n') }).catch(() => {});
        }

        if (archivosParaEnviar.length > 0) {
            await message.channel.send({ files: archivosParaEnviar }).catch(() => {});
        }

        if (canDelete && message.deletable) await message.delete().catch(() => {});

        data.logs.push({
            user_id: message.author.id,
            type: type,
            content: `Nick: ${nick}\nMotivo: ${motivo}\nTiempo: ${tiempo}\nPruebas: ${pruebasTexto}`,
            date: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });
        saveData(data);

    } catch (error) { console.error(error); }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction || !interaction.isChatInputCommand()) return;

    try {
        const { commandName } = interaction;

        if (commandName === 'setup') {
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Acceso Denegado').setColor('#6a1b9a')], ephemeral: true });
            }
            const tipo = interaction.options.getString('tipo');
            const canal = interaction.options.getChannel('canal');

            const data = loadData();
            data.channels = data.channels || {};
            data.channels[canal.id] = tipo;
            saveData(data);

            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Configuracion Guardada').setDescription(`Registrado para [${tipo}].`).setColor('#7b1fa2')], ephemeral: true });
        }

        await interaction.deferReply().catch(() => {});
        const data = loadData();

        if (commandName === 'top') {
            const staffData = data.staff || {};
            const ranking = Object.keys(staffData)
                .map(id => ({
                    id,
                    baneos: staffData[id].baneos || 0,
                    muteos: staffData[id].muteos || 0,
                    revives: staffData[id].revives || 0,
                    total: (staffData[id].baneos || 0) + (staffData[id].muteos || 0) + (staffData[id].revives || 0)
                }))
                .sort((a, b) => b.total - a.total).slice(0, 10);

            const ahora = new Date();
            const fechaFormateada = `${ahora.getDate()}/${ahora.getMonth() + 1}/${ahora.getFullYear()}`;
            const embed = new EmbedBuilder().setTitle('# Top Semanal').setColor('#6a1b9a').setTimestamp().setFooter({ text: 'SirenMc' });

            if (ranking.length === 0) {
                embed.setDescription(`📅 ${fechaFormateada}\n\nSin registros.`);
                return interaction.editReply({ embeds: [embed] });
            }

            let description = `📅 ${fechaFormateada}\n\n`;
            ranking.forEach((user, idx) => {
                let prefijo = `**${idx + 1}.**`;
                if (idx === 0) prefijo = '🥇';
                if (idx === 1) prefijo = '🥈';
                if (idx === 2) prefijo = '🥉';
                description += `${prefijo} <@${user.id}>: ⚔️${user.baneos} | 🔇${user.muteos} | ♥️${user.revives} | ⌛0h 0m 0s\n`;
            });

            embed.setDescription(description);
            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'evidencias') {
            const target = interaction.options.getUser('usuario') || interaction.user;
            const stats = (data.staff || {})[target.id] || { baneos: 0, muteos: 0, revives: 0 };

            const embed = new EmbedBuilder()
                .setTitle(`Evidencias de @${target.username}`)
                .setColor('#8e24aa')
                .setThumbnail(target.displayAvatarURL({ dynamic: true }) || null)
                .addFields(
                    { name: '⌛ Tiempo Total', value: '0h 0m 0s', inline: false },
                    { name: '⚔️ Bans', value: String(stats.baneos), inline: false },
                    { name: '🔇 Mutes', value: String(stats.muteos), inline: false },
                    { name: '♥️ Revives', value: String(stats.revives), inline: false }
                );
            return interaction.editReply({ embeds: [embed] });
        }
    } catch (e) { console.error(e); }
});

client.login(CONFIG.TOKEN);
