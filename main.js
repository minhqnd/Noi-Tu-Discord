const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { setupLogger } = require('./src/log');
const noituBot = require('./src/noitu_bot');
const noitu = require('./src/noitu');
const db = require('./src/db');

const logger = setupLogger('bot');
// Track channels with a pending /newgame vote
const pendingNewGame = new Set();

require('dotenv').config();

const isPrivate = false;
const isReplyAll = true;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;

let data;
try {
    data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
} catch (err) {
    data = { channels: {}, users: {}, channelAllowlist: [] };
}
if (!data.channels || Array.isArray(data.channels)) data.channels = {};
if (!data.users || Array.isArray(data.users)) data.users = {};
if (!Array.isArray(data.channelAllowlist)) data.channelAllowlist = data.channelAllowlist ? [data.channelAllowlist].flat() : [];

// Helper function to send current word reminder if in allowed channel and game active
async function sendWordReminder(interaction) {
    if (interaction.channel.isDMBased()) return;
    const channelId = interaction.channel.id.toString();
    if (!data.channelAllowlist.includes(channelId)) return;
    const channels = db.read('channels') || {};
    const ch = channels[channelId];
    if (!ch || !ch.word) return;
    try {
        await interaction.channel.send(`Từ hiện tại: **${ch.word}**`);
    } catch (e) {
        logger.error(`Failed to send word reminder: ${e.message}`);
    }
}

// Function to update bot status with active games count
function updateBotStatus() {
    const channels = db.read('channels') || {};
    const activeGames = Object.keys(channels).filter(id => channels[id].word).length;
    const guildCount = client.guilds.cache.size;
    
    client.user.setPresence({
        activities: [{
            name: '🎮 Nối từ Tiếng Việt',
            type: ActivityType.Playing,
            // details: `📋 ${client.application?.commands.cache.size || 6} lệnh | 🏠 ${guildCount} server`,
            state: `Chat riêng với bot cũng chơi được nhe hehe`,
        }],
        status: 'online'
    });
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
            description: 'Tra cứu từ điển tiếng việt',
            options: [
                {
                    name: 'word',
                    description: 'Từ cần tra cứu',
                    type: 3, // STRING
                    required: true
                }
            ]
        },
        {
            name: 'newgame',
            description: 'Reset nối từ - bắt đầu game mới'
        },
        {
            name: 'stats',
            description: 'Xem thống kê nối từ hiện tại'
        }
    ]);
    
    // Update application info for better bot profile
    try {
        await client.application.edit({
            description: 'Bot game nối từ Tiếng Việt bởi @minhqnd. Sử dụng /noitu_add để bắt đầu chơi!',
            tags: ['game', 'vietnamese', 'word-chain', 'entertainment', 'educational']
        });
        // logger.info('Updated application info successfully');
    } catch (error) {
        logger.error('Failed to update application info:', error.message);
    }
    
    // Set initial bot status and activity
    updateBotStatus();
    
    // Log commands info
    // const commandCount = client.application.commands.cache.size;
    logger.info(`${client.user.tag} is now running!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'noitu_add') {
        const channelId = interaction.channel.id.toString();
        if (data.channelAllowlist.includes(channelId)) {
            await interaction.reply({ content: '> **Phòng hiện tại đã có trong cơ sở dữ liệu!**', ephemeral: false });
        } else {
            data.channelAllowlist.push(channelId);
            fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
            // Khởi tạo game mới ngay sau khi thêm phòng
            const newWord = noituBot.resetChannelGame(channelId);
            await interaction.reply({
                content: `> **Đã thêm phòng game nối từ, MoiChat sẽ trả lời mọi tin nhắn từ phòng này!**\n\n🎮 **Game mới đã bắt đầu!**\nTừ hiện tại: **${newWord}**`,
                ephemeral: false
            });
            logger.info(`Thêm phòng mới ${channelId} và bắt đầu game với từ: ${newWord}`);
        }
    } else if (commandName === 'noitu_remove') {
        const channelId = interaction.channel.id.toString();
        if (data.channelAllowlist.includes(channelId)) {
            data.channelAllowlist = data.channelAllowlist.filter(id => id !== channelId);
            if (data.channels && data.channels[channelId]) {
                delete data.channels[channelId];
            }
            fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
            await interaction.reply({ content: '> **Đã xóa phòng game nối từ và toàn bộ dữ liệu của phòng này.**', ephemeral: false });
            logger.info(`Xóa phòng ${channelId} và xóa dữ liệu kèm theo!`);
        } else {
            await interaction.reply({ content: '> **Không thể xóa vì chưa thêm phòng.**', ephemeral: false });
        }
    } else if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('🎮 Moi Nối Từ - Hướng dẫn sử dụng')
            .setDescription('Bot game nối từ Tiếng Việt với từ gồm 2 chữ')
            .setColor(0x00ff00)
            .addFields(
                {
                    name: '🎯 Commands Chính',
                    value: '`/noitu_add` - Thêm phòng game nối từ\n`/noitu_remove` - Xóa phòng game nối từ\n`/newgame` - Bắt đầu game mới\n`/stats` - Xem thống kê cá nhân',
                    inline: false
                },
                {
                    name: '📚 Tiện ích',
                    value: '`/tratu [từ]` - Tra cứu từ điển\n`/help` - Hiển thị hướng dẫn này',
                    inline: false
                },
                {
                    name: '🎮 Cách chơi',
                    value: 'Nhập từ gồm 2 chữ, từ đầu phải trùng với từ cuối của bot\nVí dụ: Bot nói "**nối từ**" → Bạn phải nói từ bắt đầu bằng "**từ**"',
                    inline: false
                }
            )
            .setFooter({ text: 'Tạo bởi moi - Game nối từ Tiếng Việt' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [helpEmbed], ephemeral: false });
        await sendWordReminder(interaction);
        logger.info('Someone need help!');
    } else if (commandName === 'tratu') {
        const word = interaction.options.getString('word');
        try {
            await interaction.deferReply();
            const responses = await noitu.tratu(word || 'từ');
            const embed = new EmbedBuilder()
                .setTitle('📖 Từ điển Tiếng Việt')
                .setDescription(responses)
                // .setColor(0x00ff00)
                .setFooter({ text: 'Nguồn: minhqnd.com/api/dictionary/lookup' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            await sendWordReminder(interaction);
            logger.info(`${interaction.user.tag} Tra từ: ` + (word || 'từ'));
        } catch (e) {
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'Không thể tra từ lúc này, vui lòng thử lại sau.' });
                } else {
                    await interaction.reply({ content: 'Không thể tra từ lúc này, vui lòng thử lại sau.' });
                }
            } catch {}
            logger.error(`Tratu failed: ${e.message}`);
        }
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
            const channelId = interaction.channel.id.toString();
            if (data.channelAllowlist.includes(channelId)) {
                if (pendingNewGame.has(channelId)) {
                    await interaction.reply({ content: '⚠️ Đang có yêu cầu reset đang chờ xác nhận trong channel này.', ephemeral: true });
                    return;
                }
                const customId = `cancel_newgame_${channelId}_${Date.now()}`;
                const cancelButton = new ButtonBuilder()
                    .setCustomId(customId)
                    .setLabel('Hủy')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder().addComponents(cancelButton);

                pendingNewGame.add(channelId);
                const gameMsg = await interaction.reply({
                    content: `**${interaction.user}** muốn bỏ qua từ hiện tại. Nếu không ai hủy, game sẽ reset sau 15s.`,
                    components: [row],
                    fetchReply: true
                });

                let cancelled = false;
                const collector = gameMsg.createMessageComponentCollector({
                    filter: (i) => i.customId === customId,
                    time: 15_000
                });

                collector.on('collect', async (i) => {
                    cancelled = true;
                    try {
                        await i.update({
                            content: `Reset bị hủy bởi **${i.user}**.`,
                            components: []
                        });
                    } catch (e) {
                        logger.error(`Failed to update cancel: ${e.message}`);
                    }
                    pendingNewGame.delete(channelId);
                    collector.stop('cancelled');
                });

                collector.on('end', async (collected, reason) => {
                    if (!cancelled) {
                        try {
                            const newWord = noituBot.resetChannelGame(channelId);
                            await gameMsg.edit({
                                content: `> **${interaction.user}** đã yêu cầu bỏ qua từ hiện tại. Bắt đầu từ mới!\n\n🔤 Từ mới: **${newWord}**`,
                                components: []
                            });
                            logger.info(`User ${interaction.user.tag} started new channel game in ${channelId}`);
                        } catch (e) {
                            logger.error(`Failed to reset game: ${e.message}`);
                        }
                    }
                    pendingNewGame.delete(channelId);
                });
            } else {
                await interaction.reply({
                    content: '> **Channel này chưa được thêm vào game nối từ!**',
                    ephemeral: true
                });
            }
        }
    } else if (commandName === 'stats') {
        const userId = interaction.user.id;
        if (interaction.channel.isDMBased()) {
            const users = require('./src/db').read('users') || {};
            const dataUser = users[userId] || { word: null, history: [], currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
            const heading = `📊 Thống kê của ${interaction.user}`;
            const wordLine = dataUser.word ? `Từ hiện tại: **${dataUser.word}**` : 'Chưa bắt đầu game.';
            const stats = `> Chuỗi hiện tại: **${dataUser.currentStreak || 0}** | Cao nhất: **${dataUser.bestStreak || 0}** | Thắng: **${dataUser.wins || 0}**`;
            await interaction.reply({ content: `${heading}\n${wordLine}\n${stats}`, ephemeral: false });
            await sendWordReminder(interaction);
        } else {
            const channelId = interaction.channel.id.toString();
            const db = require('./src/db');
            const channels = db.read('channels') || {};
            const ch = channels[channelId] || {};
            const players = ch.players || {};
            const me = players[userId] || { currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
            const heading = `📊 Thống kê của ${interaction.user} trong kênh này`;
            const wordLine = ch.word ? `Từ hiện tại: **${ch.word}**` : 'Chưa bắt đầu game trong kênh này.';
            const stats = `> Chuỗi hiện tại: **${me.currentStreak || 0}** | Cao nhất: **${me.bestStreak || 0}** | Thắng: **${me.wins || 0}** | Sai: **${me.wrongCount || 0}**`;
            await interaction.reply({ content: `${heading}\n${wordLine}\n${stats}`, ephemeral: false });
            await sendWordReminder(interaction);
        }
    }
});

client.on('messageCreate', async message => {
    // Bỏ qua bot messages
    if (message.author.bot) return;

    const userMessage = message.content.toLowerCase().trim();
    const channelId = message.channel.id.toString();
    const userId = message.author.id;

    // logger.info(`Message received: ${message.author.tag} : '${userMessage}' in ${message.channel.type} (${message.channel.isDMBased() ? 'DM' : message.channel.name || 'Unknown'})`);

    try {
        if (message.channel.isDMBased()) {
            logger.info(`Processing DM from ${message.author.tag}: '${userMessage}'`);
            const response = noituBot.checkUser(userMessage, userId);
            await message.reply(response);
            logger.info(`Sent DM response to ${message.author.tag}`);
        } else {
            if (data.channelAllowlist.includes(channelId)) {
                // Block plays while a /newgame vote is pending
                if (pendingNewGame.has(channelId)) {
                    try {
                        const sent = await message.reply('🕓 Đang đợi vote reset game, vui lòng chờ...');
                        setTimeout(async () => {
                            try { await sent.delete(); } catch {}
                            try { await message.delete(); } catch {}
                        }, 3000);
                    } catch (e) {
                        logger.error(`Failed to send/delete pending vote notice: ${e.message}`);
                    }
                    return;
                }
                logger.info(`Processing channel message from ${message.author.tag}: '${userMessage}'`);
                const response = noituBot.checkChannel(userMessage, channelId, userId);
                // Nếu sai định dạng (không đủ 2 từ), reply rồi xóa sau 5s cả reply và tin nhắn gốc
                if (response && response.startsWith('Từ bắt buộc phải gồm 2 từ')) {
                    try {
                        const sent = await message.reply(response);
                        setTimeout(async () => {
                            try { await sent.delete(); } catch (e) { /* ignore */ }
                            try { await message.delete(); } catch (e) { /* ignore */ }
                        }, 3000);
                    } catch (e) {
                        logger.error(`Failed to send/delete format error reply: ${e.message}`);
                    }
                } else {
                    await message.reply(response);
                    logger.info(`Sent channel response to ${message.author.tag}`);
                }
            } else {
                // logger.info(`Channel ${channelId} not in allowed list, ignoring message`);
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