const { Client, GatewayIntentBits, REST, Routes, ApplicationCommandOptionType, EmbedBuilder, resolveColor } = require('discord.js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('OK'));
app.listen(PORT);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    {
        name: 'enviarmensaje',
        description: 'Envía un mensaje con o sin embed.',
        options: [
            { name: 'texto', description: 'Cuerpo del Embed', type: ApplicationCommandOptionType.String, required: true },
            { name: 'titulo', description: 'Título del Embed', type: ApplicationCommandOptionType.String, required: false },
            { name: 'color', description: 'Color HEX (Ej: FF5733 o #FF5733)', type: ApplicationCommandOptionType.String, required: false },
            { name: 'fuera', description: 'Texto fuera del Embed', type: ApplicationCommandOptionType.String, required: false },
            { name: 'multimedia', description: 'Foto o video', type: ApplicationCommandOptionType.Attachment, required: false }
        ]
    }
];

client.once('ready', async () => {
    if (client.user.username !== 'MineHave Staff Bot') {
        await client.user.setUsername('MineHave Staff Bot').catch(() => {});
    }
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    } catch (e) {}
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'enviarmensaje') return;

    if (!interaction.member.permissions.has('ManageMessages')) {
        return interaction.reply({ content: 'No tienes permisos.', ephemeral: true });
    }

    const texto = interaction.options.getString('texto');
    const titulo = interaction.options.getString('titulo');
    const colorInput = interaction.options.getString('color');
    const fuera = interaction.options.getString('fuera');
    const multimedia = interaction.options.getAttachment('multimedia');

    const embed = new EmbedBuilder().setDescription(texto);
    if (titulo) embed.setTitle(titulo);

    // Sistema de color corregido
    let finalColor = '#0099ff'; 
    if (colorInput) {
        let cleanColor = colorInput.replace('#', '').trim();
        if (/^[0-9A-Fa-f]{6}$/.test(cleanColor)) {
            finalColor = parseInt(cleanColor, 16);
        } else {
            try {
                finalColor = resolveColor(colorInput);
            } catch {
                finalColor = '#0099ff';
            }
        }
    }
    embed.setColor(finalColor);

    if (multimedia && multimedia.contentType && multimedia.contentType.startsWith('image/')) {
        embed.setImage(multimedia.url);
    }

    const respuesta = { embeds: [embed] };
    if (fuera) respuesta.content = fuera;
    if (multimedia && multimedia.contentType && !multimedia.contentType.startsWith('image/')) {
        respuesta.files = [multimedia.url];
    }

    await interaction.channel.send(respuesta);
    await interaction.reply({ content: 'Enviado.', ephemeral: true });
});

process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

client.login(process.env.DISCORD_TOKEN);
