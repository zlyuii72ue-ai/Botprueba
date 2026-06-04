const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Servidor web para mantener vivo el bot en Railway / Render
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('System Status: Operational');
}).listen(process.env.PORT || 3000);

// Capturas de emergencia globales absolutas para evitar que Node se apague bajo cualquier circunstancia
process.on('uncaughtException', (error) => {
    console.error('| ANTI-CRASH | Bloqueada una excepción no capturada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('| ANTI-CRASH | Bloqueada una promesa rechazada en:', promise, 'razón:', reason);
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

const FILE_PATH = path.join('/tmp', 'storage.json');

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
    // Validación inicial ultra segura
    if (!message || !message.author || message.author.bot || !message.guild) return;

    try {
        const data = loadData();
        const type = data.channels?.[message.channel.id];
        if (!type) return;

        const content = message.content ? message.content.trim() : '';
        
        // Procesar línea por línea para extraer valores de forma limpia sin importar el orden
        const lines = content.split('\n');
        let nick = '';
        let motivo = '';
        let tiempo = '';
        let pruebasTexto = '';

        lines.forEach(line => {
            const lowerLine = line.toLowerCase();
            if (lowerLine.startsWith('nick:')) nick = line.substring(5).trim();
            else if (lowerLine.startsWith('motivo:')) motivo = line.substring(7).trim();
            else if (lowerLine.startsWith('tiempo:')) tiempo = line.substring(7).trim();
            else if (lowerLine.startsWith('pruebas:')) pruebasTexto = line.substring(8).trim();
        });

        const canDelete = message.guild?.members?.me?.permissionsIn(message.channel).has('ManageMessages');

        // Los únicos campos estrictamente obligatorios para armar la base de datos
        if (!nick || !motivo || !tiempo) {
            if (canDelete && message.deletable) {
                await message.delete().catch(() => {});
            }
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('⚠️ Formato Incorrecto')
                .setDescription(`Estructura errónea enviada por ${message.author.username}.\n\nUse el formato obligatorio básico:`)
                .addFields({ name: 'Campos requeridos', value: '\`\`\`\nNick:\nMotivo:\nTiempo:\n\`\`\`\n*(El campo Pruebas: o adjuntar imágenes ahora es totalmente opcional)*' })
                .setColor('#2f3171')
                .setTimestamp();

            const warning = await message.channel.send({ embeds: [errorEmbed] });
            setTimeout(() => warning.delete().catch(() => {}), 6000);
            return;
        }

        // Buscar enlaces URL independientes dentro de lo que hayan escrito en pruebas
        let linksEncontrados = [];
        if (pruebasTexto && pruebasTexto.length > 0) {
            const linkRegex = /(https?:\/\/[^\s]+)/gi;
            linksEncontrados = pruebasTexto.match(linkRegex) || [];
        }

        // Manejo nativo de imágenes sin usar librerías externas (Evita bloqueos y errores de descarga)
        const imagenesParaEnviar = [];
        if (message.attachments && message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment && attachment.url) {
                    const urlLimpia = attachment.url.split('?')[0];
                    const esImagen = attachment.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(urlLimpia);
                    if (esImagen) {
                        // Pasamos directamente la URL. Discord.js se encarga de retransmitirla de forma anónima
                        imagenesParaEnviar.push(new AttachmentBuilder(attachment.url, { name: attachment.name || 'evidencia.png' }));
                    }
                }
            });
        }

        // Borrar el mensaje del moderador inmediatamente
        if (canDelete && message.deletable) {
            await message.delete().catch(() => {});
        }

        if (!data.staff[message.author.id]) {
            data.staff[message.author.id] = { baneos: 0, muteos: 0, revives: 0 };
        }

        data.staff[message.author.id][type] = (data.staff[message.author.id][type] || 0) + 1;
        const totalSancionesTipo = data.staff[message.author.id][type];

        const titleMap = {
            baneos: '🏮 BAN REGISTRADO',
            muteos: '🎙️ MUTE REGISTRADO',
            revives: '💫 REVIVE REGISTRADO'
        };

        const colorMap = {
            baneos: '#2f3171',
            muteos: '#4b306b',
            revives: '#1d4ed8'
        };

        const fieldTotalMap = {
            baneos: 'Total Bans',
            muteos: 'Total Mutes',
            revives: 'Total Revives'
        };

        const embed = new EmbedBuilder()
            .setTitle(titleMap[type] || 'REGISTRO')
            .setColor(colorMap[type] || '#2b2d31')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }) || null)
            .addFields(
                { name: 'Nick Sancionado', value: nick, inline: false },
                { name: 'Motivo', value: motivo, inline: false },
                { name: 'Duracion', value: tiempo, inline: false },
                { name: 'Staff', value: `${message.author}`, inline: false },
                { name: fieldTotalMap[type] || 'Total', value: String(totalSancionesTipo), inline: false }
            )
            .setTimestamp();

        if (pruebasTexto && pruebasTexto.length > 0) {
            embed.addFields({ name: 'Evidencias', value: pruebasTexto, inline: false });
        }

        // 1. Enviar el embed con la información del reporte estructurado
        await message.channel.send({ embeds: [embed] });

        // 2. Enviar los enlaces encontrados en un mensaje independiente
        if (linksEncontrados.length > 0) {
            await message.channel.send({ content: linksEncontrados.join('\n') }).catch(() => {});
        }

        // 3. Enviar los archivos adjuntos de forma anónima desde el bot
        if (imagenesParaEnviar.length > 0) {
            await message.channel.send({ files: imagenesParaEnviar }).catch(() => {});
        }

        // Guardar logs persistentes en el disco temporal
        data.logs.push({
            user_id: message.author.id,
            type: type,
            content: `Nick: ${nick}\nMotivo: ${motivo}\nTiempo: ${tiempo}\nPruebas: ${pruebasTexto}`,
            date: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });

        saveData(data);

    } catch (error) {
        console.error('Error controlado en el evento messageCreate:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction || !interaction.isChatInputCommand()) return;

    try {
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
            data.channels = data.channels || {};
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
            const staffData = data.staff || {};
            const ranking = Object.keys(staffData)
                .map(id => ({
                    id,
                    baneos: staffData[id].baneos || 0,
                    muteos: staffData[id].muteos || 0,
                    revives: staffData[id].revives || 0,
                    total: (staffData[id].baneos || 0) + (staffData[id].muteos || 0) + (staffData[id].revives || 0)
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);

            const ahora = new Date();
            const diaSemana = ahora.getDay();
            const diferencia = ahora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1);
            const lunesActual = new Date(ahora.setDate(diferencia));
            const fechaFormateada = `${lunesActual.getDate()}/${lunesActual.getMonth() + 1}/${lunesActual.getFullYear()}`;

            const embed = new EmbedBuilder()
                .setTitle('# Ranking de Rendimiento - Personal de Staff')
                .setColor('#2f3171')
                .setTimestamp()
                .setFooter({ text: 'SirenMc' });

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
            
            const staffData = data.staff || {};
            const stats = staffData[target.id] || { baneos: 0, muteos: 0, revives: 0 };

            const bvals = String(stats.baneos ?? 0);
            const mvals = String(stats.muteos ?? 0);
            const rvals = String(stats.revives ?? 0);

            const embed = new EmbedBuilder()
                .setTitle(`📊 Perfil: ${target.username || 'Desconocido'}`)
                .setColor('#1d4ed8') 
                .setThumbnail(target.displayAvatarURL({ dynamic: true }) || null)
                .addFields(
                    { name: '⏳ Tiempo Total', value: '0h 0m 0s', inline: false },
                    { name: '🔨 Bans', value: bvals, inline: false },
                    { name: '🔉 Mutes', value: mvals, inline: false },
                    { name: '💚 Revives', value: rvals, inline: false }
                );

            return interaction.editReply({ embeds: [embed] });
        }
    } catch (interactionError) {
        console.error('Error controlado en comando de interacción:', interactionError);
    }
});

client.login(CONFIG.TOKEN);
