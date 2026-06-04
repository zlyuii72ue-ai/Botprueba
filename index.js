const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('System Status: Operational');
}).listen(process.env.PORT || 3000);

// Captura absoluta de errores para evitar que el proceso de Node se apague
process.on('uncaughtException', (error) => {
    console.error('| ANTI-CRASH | Exception evitada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('| ANTI-CRASH | Rejection evitada en:', promise, 'razón:', reason);
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
    // Protección inicial básica
    if (!message || !message.author || message.author.bot || !message.guild) return;

    try {
        const data = loadData();
        const type = data.channels?.[message.channel.id];
        if (!type) return;

        const content = message.content ? message.content.trim() : '';
        if (!content) return;
        
        // Extracción limpia línea por línea para evitar romper Regex con textos aleatorios
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

        // Validación estricta de los tres datos requeridos
        if (!nick || !motivo || !tiempo) {
            if (canDelete && message.deletable) {
                await message.delete().catch(() => {});
            }
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('⚠️ Formato Incorrecto')
                .setDescription(`Estructura errónea enviada por ${message.author.username}.\n\nUse el formato obligatorio básico:`)
                .addFields({ name: 'Campos requeridos', value: '\`\`\`\nNick:\nMotivo:\nTiempo:\n\`\`\`\n*(Opcional puedes agregar Pruebas: o adjuntar una foto)*' })
                .setColor('#2f3171')
                .setTimestamp();

            const warning = await message.channel.send({ embeds: [errorEmbed] });
            setTimeout(() => warning.delete().catch(() => {}), 6000);
            return;
        }

        // Buscar enlaces si es que pusieron algo en pruebas
        let linksEncontrados = [];
        if (pruebasTexto && pruebasTexto.length > 0) {
            const linkRegex = /(https?:\/\/[^\s]+)/gi;
            linksEncontrados = pruebasTexto.match(linkRegex) || [];
        }

        // Descarga de archivos adjuntos protegida contra fallos de red
        const imagenesParaEnviar = [];
        if (message.attachments && message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (!attachment || !attachment.url) continue;
                
                const esImagen = attachment.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.url.split('?')[0]);
                if (esImagen) {
                    try {
                        const response = await axios.get(attachment.url, { responseType: 'arraybuffer', timeout: 6000 }).catch(() => null);
                        if (response && response.data) {
                            const buffer = Buffer.from(response.data, 'binary');
                            const nombreArchivo = `evidencia_${Date.now()}.png`;
                            imagenesParaEnviar.push(new AttachmentBuilder(buffer, { name: nombreArchivo }));
                        }
                    } catch (err) {
                        console.error('No se pudo procesar una imagen adjunta:', err.message);
                    }
                }
            }
        }

        // Eliminar mensaje original del staff de forma segura
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

        // 1. Enviar Embed con los datos limpios
        await message.channel.send({ embeds: [embed] });

        // 2. Enviar Links detectados por separado si existen
        if (linksEncontrados.length > 0) {
            await message.channel.send({ content: linksEncontrados.join('\n') }).catch(() => {});
        }

        // 3. Enviar imágenes descargadas de manera 100% anónima
        if (imagenesParaEnviar.length > 0) {
            await message.channel.send({ files: imagenesParaEnviar }).catch(() => {});
        }

        // Guardar logs internos
        data.logs.push({
            user_id: message.author.id,
            type: type,
            content: `Nick: ${nick}\nMotivo: ${motivo}\nTiempo: ${tiempo}\nPruebas: ${pruebasTexto}`,
            date: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });

        saveData(data);

    } catch (error) {
        console.error('Error controlado en messageCreate para evitar crash:', error);
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
