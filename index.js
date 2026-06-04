const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

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

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS staff_data (
        user_id TEXT PRIMARY KEY,
        baneos INTEGER DEFAULT 0,
        muteos INTEGER DEFAULT 0,
        revives INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        type TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS channels (
        type TEXT PRIMARY KEY,
        channel_id TEXT
    )`);
});

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
    console.log(`Sesión iniciada: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    db.all(`SELECT * FROM channels`, async (err, rows) => {
        if (err) return;
        
        const activeChannels = {};
        rows.forEach(row => { activeChannels[row.channel_id] = row.type; });

        if (!activeChannels[message.channel.id]) return;

        const type = activeChannels[message.channel.id];
        const rawContent = message.content;
        const formatCheck = /^Nick:\s*(.+)\nMotivo:\s*(.+)\nTiempo:\s*(.+)\nPruebas:\s*(.+)$/i;

        if (!formatCheck.test(rawContent)) {
            try {
                await message.delete();
                const warning = await message.channel.send(`⚠️ **${message.author.username}**, el formato enviado es incorrecto. Utiliza la plantilla obligatoria:\n\`\`\`\nNick:\nMotivo:\nTiempo:\nPruebas:\n\`\`\``);
                setTimeout(() => warning.delete().catch(() => {}), 6000);
            } catch (e) {
                console.error('Error de moderación de formato:', e);
            }
            return;
        }

        db.run(`INSERT OR IGNORE INTO staff_data (user_id) VALUES (?)`, [message.author.id]);
        db.run(`UPDATE staff_data SET ${type} = ${type} + 1 WHERE user_id = ?`, [message.author.id]);
        db.run(`INSERT INTO logs (user_id, type, content) VALUES (?, ?, ?)`, [message.author.id, type, rawContent]);

        message.react('✅').catch(() => {});
    });
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

        db.run(`INSERT OR REPLACE INTO channels (type, channel_id) VALUES (?, ?)`, [tipo, canal.id], (err) => {
            if (err) return interaction.reply({ content: 'Error interno en la base de datos.', ephemeral: true });
            interaction.reply({ content: `Canal para **${tipo}** asignado correctamente en ${canal}.`, ephemeral: true });
        });
    }

    if (commandName === 'top') {
        db.all(`SELECT * FROM staff_data ORDER BY (baneos + muteos + revives) DESC LIMIT 10`, (err, rows) => {
            if (err) return interaction.reply({ content: 'Error al procesar el ranking.', ephemeral: true });

            if (rows.length === 0) {
                return interaction.reply({ content: 'No se encontraron registros en el sistema.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('🏆 TOP 10 ACTIVIDAD STAFF 🏆')
                .setColor('#D4AF37')
                .setTimestamp()
                .setFooter({ text: 'iLoveTungtung_' });

            let list = '';
            rows.forEach((row, i) => {
                const total = row.baneos + row.muteos + row.revives;
                list += `**#${i + 1}** <@${row.user_id}> — Total: \`${total}\`\n✖️ \`${row.baneos}\` | 🔇 \`${row.muteos}\` | 💗 \`${row.revives}\`\n\n`;
            });

            embed.setDescription(list);
            interaction.reply({ embeds: [embed] });
        });
    }

    if (commandName === 'evidencias') {
        const target = interaction.options.getUser('usuario') || interaction.user;

        db.all(`SELECT * FROM logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [target.id], (err, rows) => {
            if (err) return interaction.reply({ content: 'Error al extraer la información.', ephemeral: true });

            if (rows.length === 0) {
                return interaction.reply({ content: `El usuario <@${target.id}> no registra evidencias.` });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Registros Recientes — ${target.username}`)
                .setColor('#2B2D31')
                .setFooter({ text: 'iLoveTungtung_' });

            rows.forEach((row, index) => {
                const badge = row.type === 'baneos' ? '✖️' : row.type === 'muteos' ? '🔇' : '💗';
                const trimmedText = row.content.length > 250 ? row.content.substring(0, 250) + '...' : row.content;
                
                embed.addFields({
                    name: `[${index + 1}] Acción: ${badge} ${row.type.toUpperCase()}`,
                    value: `\`\`\`\n${trimmedText}\n\`\`\`*Fecha: ${row.created_at}*`
                });
            });

            interaction.reply({ embeds: [embed] });
        });
    }
});

client.login(CONFIG.TOKEN);
          
