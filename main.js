const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { setupLogger } = require('./src/log');
const noituBot = require('./src/noitu_bot');
const noitu = require('./src/noitu');

const logger = setupLogger('bot');

require('dotenv').config();

const isPrivate = false;
const isReplyAll = true;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;

let data;
try {
    data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
} catch (err) {
    data = { channels: [] };
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel] // Cần để nhận DM
});

client.once('clientReady', async () => {
    await client.application.commands.set([
        {
            name: 'noitu_add',
            description: 'Thêm phòng game nối từ'
        },
        {
            name: 'noitu_remove',
            description: 'Xóa phòng game nối từ'
        },
        {
            name: 'help',
            description: 'Hiển thị trợ giúp của bot'
        },
        {
            name: 'tratu',
            description: 'Tra từ hiện tại đang nối từ',
            options: [
                {
                    name: 'word',
                    description: 'Từ cần tra',
                    type: 3, // STRING
                    required: false
                }
            ]
        },
        {
            name: 'newgame',
            description: 'Reset nối từ - bắt đầu game mới'
        }
    ]);
    logger.info(`${client.user.tag} is now running!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'noitu_add') {
        const channelId = interaction.channel.id.toString();
        if (data.channels.includes(channelId)) {
            await interaction.reply({ content: '> **Phòng hiện tại đã có trong cơ sở dữ liệu!**', ephemeral: false });
        } else {
            data.channels.push(channelId);
            fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
            await interaction.reply({ content: '> **Đã thêm phòng game nối từ, MoiChat sẽ trả lời mọi tin nhắn từ phòng này!**', ephemeral: false });
            logger.info(`Thêm phòng mới ${channelId}!`);
        }
    } else if (commandName === 'noitu_remove') {
        const channelId = interaction.channel.id.toString();
        if (data.channels.includes(channelId)) {
            data.channels = data.channels.filter(id => id !== channelId);
            fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
            await interaction.reply({ content: '> **Đã xóa phòng game nối từ.**', ephemeral: false });
            logger.info(`Xóa phòng ${channelId}!`);
        } else {
            await interaction.reply({ content: '> **Không thể xóa vì chưa thêm phòng.**', ephemeral: false });
        }
    } else if (commandName === 'help') {
        await interaction.reply({
            content: ":star:**BASIC COMMANDS** \n\n    - `/chatadd` Thêm phòng chat tự động!\n    - `/chatremove` Xóa phòng chat tự động.\n    - `/noituadd` Thêm phòng game nối từ.\n    - `/noituremove` Xóa phòng game nối từ.",
            ephemeral: false
        });
        logger.info('Someone need help!');
    } else if (commandName === 'tratu') {
        const word = interaction.options.getString('word');
        const responses = await noitu.tratu(word || 'từ');
        const embed = new EmbedBuilder()
            .setTitle('Từ điển Tiếng Việt')
            .setDescription(responses);
        await interaction.reply({ embeds: [embed], ephemeral: false });
        logger.info('Tra từ!');
    } else if (commandName === 'newgame') {
        const userId = interaction.user.id;

        if (interaction.channel.isDMBased()) {
            // Reset game cho DM
            const newWord = noituBot.resetUserGame(userId);
            await interaction.reply({
                content: `🎮 **Game mới đã bắt đầu!**\nTừ hiện tại: **${newWord}**`,
                ephemeral: false
            });
            logger.info(`User ${interaction.user.tag} started new DM game`);
        } else {
            // Reset game cho channel (chỉ admin/mod có thể reset)
            const channelId = interaction.channel.id.toString();
            if (data.channels.includes(channelId)) {
                const newWord = noituBot.resetChannelGame(channelId);
                await interaction.reply({
                    content: `🎮 **Game mới đã bắt đầu cho channel này!**\nTừ hiện tại: **${newWord}**`,
                    ephemeral: false
                });
                logger.info(`User ${interaction.user.tag} started new channel game in ${channelId}`);
            } else {
                await interaction.reply({
                    content: '> **Channel này chưa được thêm vào game nối từ!**',
                    ephemeral: true
                });
            }
        }
    }
});

client.on('messageCreate', async message => {
    // Bỏ qua bot messages
    if (message.author.bot) return;

    const userMessage = message.content.toLowerCase().trim();
    const channelId = message.channel.id.toString();
    const userId = message.author.id;

    logger.info(`Message received: ${message.author.tag} : '${userMessage}' in ${message.channel.type} (${message.channel.isDMBased() ? 'DM' : message.channel.name || 'Unknown'})`);

    try {
        if (message.channel.isDMBased()) {
            logger.info(`Processing DM from ${message.author.tag}: '${userMessage}'`);
            const response = noituBot.checkUser(userMessage, userId);
            await message.channel.send(response);
            logger.info(`Sent DM response to ${message.author.tag}`);
        } else {
            if (data.channels.includes(channelId)) {
                logger.info(`Processing channel message from ${message.author.tag}: '${userMessage}'`);
                const response = noituBot.checkChannel(userMessage, channelId, userId);
                await message.channel.send(response);
                logger.info(`Sent channel response to ${message.author.tag}`);
            } else {
                logger.info(`Channel ${channelId} not in allowed list, ignoring message`);
            }
        }
    } catch (error) {
        logger.error(`Error processing message: ${error.message}`);
        logger.error(`Stack: ${error.stack}`);
    }
});

function runDiscordBot() {
    // keepAlive(); // Không cần keep alive
    client.login(process.env.DISCORD_BOT_TOKEN);
}

runDiscordBot();