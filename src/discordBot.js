const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActivityType, ChannelType, MessageFlags, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { setupLogger, GAME_CONSTANTS, PERMISSIONS, PATHS } = require('./utils');
const gameLogic = require('./gameLogic');
const db = require('./db');

const logger = setupLogger('discord_bot');

class DiscordBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages
            ],
            partials: [
                Partials.Channel,
                Partials.Message,
                Partials.User,
                Partials.GuildMember
            ] // Cần để nhận DM và partial messages
        });

        this.pendingNewGame = new Set();
        this.dataPath = path.join(__dirname, '..', PATHS.DATA_FILE);
        this.data = this.loadData();

        this.setupEventHandlers();
    }

    loadData() {
        try {
            const raw = fs.readFileSync(this.dataPath, 'utf8');
            return raw ? JSON.parse(raw) : this.getDefaultData();
        } catch (err) {
            return this.getDefaultData();
        }
    }

    getDefaultData() {
        return {
            channels: {},
            users: {},
            channelAllowlist: [],
            feedbacks: []
        };
    }

    saveData() {
        try {
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (error) {
            logger.error('Failed to save data:', error.message);
        }
    }

    setupEventHandlers() {
        this.client.once('clientReady', () => this.onReady());
        this.client.on('interactionCreate', (interaction) => this.onInteractionCreate(interaction));
        
        // Log when bot receives any message with debug info
        this.client.on('messageCreate', async (message) => {
            try {
                // Check if message is partial and fetch if needed
                if (message.partial) {
                    await message.fetch();
                }
                
                await this.onMessageCreate(message);
            } catch (error) {
                logger.error(`Error in messageCreate event: ${error.message}`);
            }
        });
    }

    async onReady() {
        await this.client.application.commands.set(this.getCommands());
        this.updateBotStatus();
        logger.info(`${this.client.user.tag} is now running!`);
    }

    getCommands() {
        return [
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
            },
            // {
            //     name: 'feedback',
            //     description: 'Gửi phản hồi về từ thiếu, lỗi hoặc đề xuất'
            // },
            // {
            //     name: 'viewfeedback',
            //     description: '[ADMIN] Xem tất cả phản hồi từ người dùng'
            // },
            {
                name: 'noitu_mode',
                description: 'Chọn chế độ chơi cho kênh: bot hoặc pvp',
                options: [
                    {
                        name: 'mode',
                        description: 'Chế độ chơi (bot: user vs bot, pvp: user vs user)',
                        type: 3, // STRING
                        required: true,
                        choices: [
                            { name: 'user vs bot', value: 'bot' },
                            { name: 'user vs user (PvP)', value: 'pvp' }
                        ]
                    }
                ]
            }
        ];
    }

    updateBotStatus() {
        this.client.user.setPresence({
            activities: [{
                name: '🎮 Nối từ Tiếng Việt',
                type: ActivityType.Playing,
                state: `Chat riêng với bot cũng chơi được nhe hehe`,
            }],
            status: 'online'
        });
    }

    // Helper function to check if channel is DM
    isDirectMessage(channel) {
        if (!channel) {
            return false;
        }
        return channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM;
    }

    getCurrentWord(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            const users = db.read('users') || {};
            const userData = users[interaction.user.id] || {};
            return userData.word;
        } else {
            const channels = db.read('channels') || {};
            const channelData = channels[interaction.channel.id.toString()] || {};
            return channelData.word;
        }
    }

    async onInteractionCreate(interaction) {
        if (interaction.isCommand()) {
            const { commandName } = interaction;

            try {
                switch (commandName) {
                    case 'noitu_add':
                        await this.handleNoituAdd(interaction);
                        break;
                    case 'noitu_remove':
                        await this.handleNoituRemove(interaction);
                        break;
                    case 'help':
                        await this.handleHelp(interaction);
                        break;
                    case 'tratu':
                        await this.handleTratu(interaction);
                        break;
                    case 'newgame':
                        await this.handleNewgame(interaction);
                        break;
                    case 'stats':
                        await this.handleStats(interaction);
                        break;
                    case 'feedback':
                        await this.handleFeedback(interaction);
                        break;
                    case 'viewfeedback':
                        await this.handleViewFeedback(interaction);
                        break;
                    case 'noitu_mode':
                        await this.handleNoituMode(interaction);
                        break;
                }
            } catch (error) {
                logger.error(`Error handling command ${commandName}:`, error);
                await interaction.reply({
                    content: 'Có lỗi xảy ra khi xử lý lệnh. Vui lòng thử lại sau.',
                    ephemeral: true
                }).catch(() => { });
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_feedback') {
                await this.handleSelectFeedback(interaction);
            } else if (interaction.customId === 'select_feedback_type') {
                await this.handleSelectFeedbackType(interaction);
            }
        } else if (interaction.isButton()) {
            if (interaction.customId.startsWith('edit_feedback_')) {
                await this.handleResolveFeedback(interaction);
            } else if (interaction.customId.startsWith('delete_feedback_')) {
                await this.handleDeleteFeedback(interaction);
            } else if (interaction.customId === 'back_to_feedback_list') {
                await this.handleBackToFeedbackList(interaction);
            }
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('feedback_modal_')) {
                await this.handleFeedbackModalSubmit(interaction);
            }
        }
    }

    async handleNoituAdd(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        
        const channelId = interaction.channel.id.toString();
        if (this.data.channelAllowlist.includes(channelId)) {
            await interaction.reply({ content: '> **Phòng hiện tại đã có trong cơ sở dữ liệu!**', ephemeral: false });
        } else {
            this.data.channelAllowlist.push(channelId);
            this.saveData();
            const newWord = gameLogic.resetChannelGame(channelId);
            await interaction.reply({
                content: `> **Đã thêm phòng game nối từ, MoiChat sẽ trả lời mọi tin nhắn từ phòng này!**\n\n🎮 **Game mới đã bắt đầu!**\nTừ hiện tại: **${newWord}**`,
                ephemeral: false
            });
            logger.info(`Thêm phòng mới ${channelId} và bắt đầu game với từ: ${newWord}`);
        }
    }

    async handleNoituRemove(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        
        const channelId = interaction.channel.id.toString();
        if (this.data.channelAllowlist.includes(channelId)) {
            this.data.channelAllowlist = this.data.channelAllowlist.filter(id => id !== channelId);
            if (this.data.channels && this.data.channels[channelId]) {
                delete this.data.channels[channelId];
            }
            this.saveData();
            await interaction.reply({ content: '> **Đã xóa phòng game nối từ và toàn bộ dữ liệu của phòng này.**', ephemeral: false });
            logger.info(`Xóa phòng ${channelId} và xóa dữ liệu kèm theo!`);
        } else {
            await interaction.reply({ content: '> **Không thể xóa vì chưa thêm phòng.**', ephemeral: false });
        }
    }

    async handleHelp(interaction) {
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
                    value: '`/tratu [từ]` - Tra cứu từ điển\n`/feedback [nội dung]` - Gửi phản hồi về từ thiếu/lỗi\n`/noitu_mode [bot|pvp]` - Đặt chế độ chơi của kênh\n`/help` - Hiển thị hướng dẫn này',
                    inline: false
                },
                {
                    name: '👮 Moderator/Admin',
                    value: '`/viewfeedback` - Xem phản hồi từ người dùng',
                    inline: false
                },
                {
                    name: '🎮 Cách chơi',
                    value: 'Nhập từ gồm 2 chữ.\n• Chế độ bot: bot sẽ đưa ra từ tiếp theo.\n• Chế độ PvP: bot chỉ kiểm tra và thả reaction (✅ đúng, ❌ sai/ko có từ, 🔴 đã lặp, ⚠️ sai format).\n• Từ không có trong từ điển sẽ được coi là sai.',
                    inline: false
                }
            )
            .setFooter({ text: 'Tạo bởi moi - Game nối từ Tiếng Việt' })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed], ephemeral: false });

        const currentWord = this.getCurrentWord(interaction);
        if (currentWord) {
            await interaction.channel.send(`Từ hiện tại: **${currentWord}**`);
        }
        logger.info('Someone need help!');
    }

    async handleTratu(interaction) {
        const word = interaction.options.getString('word');
        try {
            await interaction.deferReply();
            const responses = await gameLogic.tratu(word || 'từ');
            const embed = new EmbedBuilder()
                .setTitle('📖 Từ điển Tiếng Việt')
                .setDescription(responses)
                .setFooter({ text: 'Nguồn: minhqnd.com/api/dictionary/lookup' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });

            const currentWord = this.getCurrentWord(interaction);
            if (currentWord) {
                await interaction.channel.send(`Từ hiện tại: **${currentWord}**`);
            }
            logger.info(`${interaction.user.tag} Tra từ: ` + (word || 'từ'));
        } catch (e) {
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'Không thể tra từ lúc này, vui lòng thử lại sau.' });
                } else {
                    await interaction.reply({ content: 'Không thể tra từ lúc này, vui lòng thử lại sau.' });
                }
            } catch { }
            logger.error(`Tratu failed: ${e.message}`);
        }
    }

    async handleNewgame(interaction) {
        const userId = interaction.user.id;

        // Check if interaction.channel exists and is DM
        if (!interaction.channel) {
            await interaction.reply({
                content: '❌ Không thể xác định loại kênh. Vui lòng thử lại.',
                ephemeral: true
            });
            return;
        }

        if (this.isDirectMessage(interaction.channel)) {
            const newWord = gameLogic.resetUserGame(userId);
            await interaction.reply({
                content: `🎮 **Game mới đã bắt đầu!**\nTừ hiện tại: **${newWord}**`,
                ephemeral: false
            });
            logger.info(`User ${interaction.user.tag} started new DM game`);
        } else {
            const channelId = interaction.channel.id.toString();
            if (this.data.channelAllowlist.includes(channelId)) {
                if (this.pendingNewGame.has(channelId)) {
                    await interaction.reply({ content: '⚠️ Đang có yêu cầu reset đang chờ xác nhận trong channel này.', ephemeral: true });
                    return;
                }
                const customId = `cancel_newgame_${channelId}_${Date.now()}`;
                const cancelButton = new ButtonBuilder()
                    .setCustomId(customId)
                    .setLabel('Hủy')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder().addComponents(cancelButton);

                this.pendingNewGame.add(channelId);
                const gameMsg = await interaction.reply({
                    content: `**${interaction.user}** muốn bỏ qua từ hiện tại. Nếu không ai hủy, game sẽ reset sau ${GAME_CONSTANTS.PENDING_GAME_TIMEOUT / 1000}s.`,
                    components: [row],
                    fetchReply: true
                });

                let cancelled = false;
                const collector = gameMsg.createMessageComponentCollector({
                    filter: (i) => i.customId === customId,
                    time: GAME_CONSTANTS.PENDING_GAME_TIMEOUT
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
                    this.pendingNewGame.delete(channelId);
                    collector.stop('cancelled');
                });

                collector.on('end', async (collected, reason) => {
                    if (!cancelled) {
                        try {
                            const newWord = gameLogic.resetChannelGame(channelId);
                            await gameMsg.edit({
                                content: `> **${interaction.user}** đã yêu cầu bỏ qua từ hiện tại. Bắt đầu từ mới!\n\n🔤 Từ mới: **${newWord}**`,
                                components: []
                            });
                            logger.info(`User ${interaction.user.tag} started new channel game in ${channelId}`);
                        } catch (e) {
                            logger.error(`Failed to reset game: ${e.message}`);
                        }
                    }
                    this.pendingNewGame.delete(channelId);
                });
            } else {
                await interaction.reply({
                    content: '> **Channel này chưa được thêm vào game nối từ!**',
                    ephemeral: true
                });
            }
        }
    }

    async handleStats(interaction) {
        const userId = interaction.user.id;
        if (this.isDirectMessage(interaction.channel)) {
            const users = db.read('users') || {};
            const dataUser = users[userId] || { word: null, history: [], currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
            const heading = `Thống kê của ${interaction.user}`;
            const stats = `> Chuỗi hiện tại: **${dataUser.currentStreak || 0}** | Cao nhất: **${dataUser.bestStreak || 0}** | Thắng: **${dataUser.wins || 0}**`;
            await interaction.reply({ content: `${heading}\n${stats}`, ephemeral: false });

            if (dataUser.word) {
                await interaction.channel.send(`Từ hiện tại: **${dataUser.word}**`);
            }
        } else {
            const channelId = interaction.channel.id.toString();
            const channels = db.read('channels') || {};
            const ch = channels[channelId] || {};
            const players = ch.players || {};
            const me = players[userId] || { currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
            const heading = `Thống kê của ${interaction.user} trong kênh này`;
            const stats = `> Chuỗi hiện tại: **${me.currentStreak || 0}** | Cao nhất: **${me.bestStreak || 0}** | Thắng: **${me.wins || 0}**`;
            await interaction.reply({ content: `${heading}\n${stats}`, ephemeral: false });

            if (ch.word) {
                await interaction.channel.send(`Từ hiện tại: **${ch.word}**`);
            }
        }
    }

    async handleFeedback(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_feedback_type')
            .setPlaceholder('Chọn loại phản hồi')
            .addOptions([
                {
                    label: 'Từ còn thiếu',
                    description: 'Phản hồi về từ chưa có trong từ điển',
                    value: 'missing_word'
                },
                {
                    label: 'Lỗi',
                    description: 'Báo lỗi trong bot hoặc game',
                    value: 'bug'
                },
                {
                    label: 'Đóng góp tính năng',
                    description: 'Đề xuất tính năng mới hoặc cải thiện',
                    value: 'feature_request'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📝 Gửi phản hồi')
            .setDescription('Chọn loại phản hồi bạn muốn gửi.')
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    async handleViewFeedback(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        
        const hasModPermissions = interaction.member?.permissions?.has(PERMISSIONS.MODERATE_MEMBERS) ||
            interaction.member?.permissions?.has(PERMISSIONS.ADMINISTRATOR) ||
            interaction.member?.permissions?.has(PERMISSIONS.MANAGE_MESSAGES) ||
            interaction.member?.permissions?.has(PERMISSIONS.MANAGE_GUILD);

        if (!hasModPermissions) {
            await interaction.reply({
                content: '❌ Bạn không có quyền sử dụng lệnh này. Chỉ Moderator/Admin mới có thể xem phản hồi.',
                ephemeral: true
            });
            return;
        }

        try {
            const feedbacks = gameLogic.getAllFeedbacks();

            if (feedbacks.length === 0) {
                await interaction.reply({
                    content: '📭 Chưa có phản hồi nào từ người dùng.',
                    ephemeral: true
                });
                return;
            }

            const recentFeedbacks = feedbacks.slice(-10).reverse();

            const embed = new EmbedBuilder()
                .setTitle('📋 Phản hồi từ người dùng')
                .setDescription(`Hiển thị ${recentFeedbacks.length} phản hồi gần nhất (tổng: ${feedbacks.length})\nChọn một phản hồi từ dropdown để xem chi tiết.`)
                .setColor(0x0099FF)
                .setTimestamp();

            recentFeedbacks.forEach((feedback, index) => {
                const date = new Date(feedback.timestamp).toLocaleString('vi-VN');
                const status = feedback.status === 'pending' ? '🟡 Chờ xử lý' : '✅ Đã giải quyết';

                embed.addFields({
                    name: `${index + 1}. ${feedback.username} - ${date}`,
                    value: `**ID:** ${feedback.id}\n**Nội dung:** ${feedback.content.substring(0, 200)}${feedback.content.length > 200 ? '...' : ''}\n**Trạng thái:** ${status}`,
                    inline: false
                });
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_feedback')
                .setPlaceholder('Chọn phản hồi để xem chi tiết')
                .addOptions(
                    recentFeedbacks.map((feedback, index) => ({
                        label: `${index + 1}. ${feedback.username}`,
                        description: feedback.content.substring(0, 50) + (feedback.content.length > 50 ? '...' : ''),
                        value: feedback.id.toString()
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            logger.info(`Admin ${interaction.user.tag} viewed feedbacks`);
        } catch (error) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi lấy phản hồi. Vui lòng thử lại sau.',
                ephemeral: true
            });
            logger.error(`Failed to get feedbacks: ${error.message}`);
        }
    }

    async handleNoituMode(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            await interaction.reply({ content: 'Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        const hasPerm = interaction.member?.permissions?.has(PERMISSIONS.MANAGE_GUILD) ||
            interaction.member?.permissions?.has(PERMISSIONS.ADMINISTRATOR);
        if (!hasPerm) {
            await interaction.reply({ content: '❌ Bạn cần quyền Manage Server để đổi chế độ.', ephemeral: true });
            return;
        }
        const mode = interaction.options.getString('mode');
        const channelId = interaction.channel.id.toString();
        const channels = db.read('channels') || {};
        const ch = channels[channelId] || {};
        ch.mode = mode;
        channels[channelId] = ch;
        db.store('channels', channels);
        const label = mode === 'pvp' ? 'user vs user (PvP)' : 'user vs bot';
        await interaction.reply({ content: `✅ Đã đặt chế độ cho kênh này: **${label}**.`, ephemeral: false });

        const currentWord = this.getCurrentWord(interaction);
        if (currentWord) {
            await interaction.channel.send(`Từ hiện tại: **${currentWord}**`);
        }
    }

    async handleSelectFeedback(interaction) {
        const feedbackId = interaction.values[0];
        const feedbacks = gameLogic.getAllFeedbacks();
        const feedback = feedbacks.find(f => f.id == feedbackId);

        if (!feedback) {
            await interaction.reply({ content: '❌ Không tìm thấy phản hồi này.', ephemeral: true });
            return;
        }

        const date = new Date(feedback.timestamp).toLocaleString('vi-VN');
        const status = feedback.status === 'pending' ? '🟡 Chờ xử lý' : '✅ Đã giải quyết';

        const embed = new EmbedBuilder()
            .setTitle('📝 Chi tiết phản hồi')
            .setColor(0x00FF00)
            .addFields(
                { name: 'ID', value: feedback.id.toString(), inline: true },
                { name: 'Người dùng', value: feedback.username, inline: true },
                { name: 'Thời gian', value: date, inline: true },
                { name: 'Trạng thái', value: status, inline: true },
                { name: 'Nội dung', value: feedback.content, inline: false }
            )
            .setTimestamp();

        const editButton = new ButtonBuilder()
            .setCustomId(`edit_feedback_${feedback.id}`)
            .setLabel('Đã giải quyết')
            .setStyle(ButtonStyle.Primary);

        const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_feedback_${feedback.id}`)
            .setLabel('Xóa')
            .setStyle(ButtonStyle.Danger);

        const backButton = new ButtonBuilder()
            .setCustomId('back_to_feedback_list')
            .setLabel('Quay lại')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(editButton, deleteButton, backButton);

        await interaction.update({ embeds: [embed], components: [row] });
    }

    async handleSelectFeedbackType(interaction) {
        const feedbackType = interaction.values[0];

        const modal = new ModalBuilder()
            .setCustomId(`feedback_modal_${feedbackType}`)
            .setTitle('Gửi phản hồi');

        const contentInput = new TextInputBuilder()
            .setCustomId('feedback_content')
            .setLabel('Nội dung phản hồi')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Mô tả chi tiết phản hồi của bạn...')
            .setRequired(true)
            .setMaxLength(1000);

        const firstActionRow = new ActionRowBuilder().addComponents(contentInput);

        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
    }

    async handleResolveFeedback(interaction) {
        const feedbackId = interaction.customId.split('_')[2];
        // Mark as resolved
        const feedbacks = gameLogic.getAllFeedbacks();
        const feedback = feedbacks.find(f => f.id == feedbackId);
        if (feedback) {
            feedback.status = 'resolved';
            gameLogic.saveFeedbacks(feedbacks);

            // Update embed with new status
            const date = new Date(feedback.timestamp).toLocaleString('vi-VN');
            const status = '✅ Đã giải quyết';

            const embed = new EmbedBuilder()
                .setTitle('📝 Chi tiết phản hồi')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'ID', value: feedback.id.toString(), inline: true },
                    { name: 'Người dùng', value: feedback.username, inline: true },
                    { name: 'Thời gian', value: date, inline: true },
                    { name: 'Trạng thái', value: status, inline: true },
                    { name: 'Nội dung', value: feedback.content, inline: false }
                )
                .setTimestamp();

            // Disable buttons
            const editButton = new ButtonBuilder()
                .setCustomId(`edit_feedback_${feedback.id}`)
                .setLabel('Đã giải quyết')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true);

            const deleteButton = new ButtonBuilder()
                .setCustomId(`delete_feedback_${feedback.id}`)
                .setLabel('Xóa')
                .setStyle(ButtonStyle.Danger);

            const backButton = new ButtonBuilder()
                .setCustomId('back_to_feedback_list')
                .setLabel('Quay lại')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(editButton, deleteButton, backButton);

            await interaction.update({ embeds: [embed], components: [row] });
        } else {
            await interaction.update({ content: '❌ Không tìm thấy phản hồi.', embeds: [], components: [] });
        }
    }

    async handleDeleteFeedback(interaction) {
        const feedbackId = interaction.customId.split('_')[2];
        const feedbacks = gameLogic.getAllFeedbacks();
        const index = feedbacks.findIndex(f => f.id == feedbackId);
        if (index !== -1) {
            feedbacks.splice(index, 1);
            gameLogic.saveFeedbacks(feedbacks);
            // Quay về list feedback
            await this.handleBackToFeedbackList(interaction);
        } else {
            await interaction.update({ content: '❌ Không tìm thấy phản hồi.', embeds: [], components: [] });
        }
    }

    async handleBackToFeedbackList(interaction) {
        const feedbacks = gameLogic.getAllFeedbacks();

        if (feedbacks.length === 0) {
            await interaction.update({
                content: '📭 Chưa có phản hồi nào từ người dùng.',
                embeds: [],
                components: []
            });
            return;
        }

        const recentFeedbacks = feedbacks.slice(-10).reverse();

        const embed = new EmbedBuilder()
            .setTitle('📋 Phản hồi từ người dùng')
            .setDescription(`Hiển thị ${recentFeedbacks.length} phản hồi gần nhất (tổng: ${feedbacks.length})\nChọn một phản hồi từ dropdown để xem chi tiết.`)
            .setColor(0x0099FF)
            .setTimestamp();

        recentFeedbacks.forEach((feedback, index) => {
            const date = new Date(feedback.timestamp).toLocaleString('vi-VN');
            const status = feedback.status === 'pending' ? '🟡 Chờ xử lý' : '✅ Đã giải quyết';

            embed.addFields({
                name: `${index + 1}. ${feedback.username} - ${date}`,
                value: `**ID:** ${feedback.id}\n**Nội dung:** ${feedback.content.substring(0, 200)}${feedback.content.length > 200 ? '...' : ''}\n**Trạng thái:** ${status}`,
                inline: false
            });
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_feedback')
            .setPlaceholder('Chọn phản hồi để xem chi tiết')
            .addOptions(
                recentFeedbacks.map((feedback, index) => ({
                    label: `${index + 1}. ${feedback.username}`,
                    description: feedback.content.substring(0, 50) + (feedback.content.length > 50 ? '...' : ''),
                    value: feedback.id.toString()
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.update({ embeds: [embed], components: [row] });
    }

    async handleFeedbackModalSubmit(interaction) {
        const feedbackType = interaction.customId.split('_')[2];
        const content = interaction.fields.getTextInputValue('feedback_content');

        const userId = interaction.user.id;
        const username = interaction.user.tag;
        const channelId = this.isDirectMessage(interaction.channel) ? null : interaction.channel.id;

        const typeLabels = {
            missing_word: 'Từ còn thiếu',
            bug: 'Lỗi',
            feature_request: 'Đóng góp tính năng'
        };

        const typeLabel = typeLabels[feedbackType] || 'Khác';
        const fullContent = `[${typeLabel}] ${content}`;

        try {
            const feedbackId = gameLogic.storeFeedback(userId, username, fullContent, channelId);
            const embed = new EmbedBuilder()
                .setTitle('✅ Phản hồi đã được gửi')
                .setDescription(`Cảm ơn bạn đã gửi phản hồi! Chúng tôi sẽ xem xét và cải thiện.\n\n**Loại:** ${typeLabel}\n**ID phản hồi:** ${feedbackId}`)
                .setColor(0x00FF00)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            logger.info(`Feedback received from ${username}: ${fullContent.substring(0, 100)}...`);
        } catch (error) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi gửi phản hồi. Vui lòng thử lại sau.',
                ephemeral: true
            });
            logger.error(`Failed to store feedback: ${error.message}`);
        }
    }

    async onMessageCreate(message) {
        if (message.author.bot) return;

        const userMessage = message.content.toLowerCase().trim();
        const channelId = message.channel.id.toString();
        const userId = message.author.id;

        try {
            if (this.isDirectMessage(message.channel)) {
                const response = gameLogic.checkUser(userMessage, userId);
                const embed = new EmbedBuilder()
                    .setDescription(response.message)
                    .setColor(response.type === 'success' ? 0x00FF00 : response.type === 'error' ? 0xFF0000 : 0x0099FF);
                await message.reply({ embeds: [embed] });
                if (response.currentWord) {
                    await message.channel.send(`Từ hiện tại: **${response.currentWord}**`);
                }
            } else {
                if (this.data.channelAllowlist.includes(channelId)) {
                    if (this.pendingNewGame.has(channelId)) {
                        try {
                            const embed = new EmbedBuilder()
                                .setDescription('🕓 Đang đợi vote reset game, vui lòng chờ...')
                                .setColor(0xFFFF00);
                            const sent = await message.reply({ embeds: [embed] });
                            setTimeout(async () => {
                                try { await sent.delete(); } catch { }
                                try { await message.delete(); } catch { }
                            }, GAME_CONSTANTS.BLOCK_MESSAGE_TIMEOUT);
                        } catch (e) {
                            logger.error(`Failed to send/delete pending vote notice: ${e.message}`);
                        }
                        return;
                    }
                    const response = gameLogic.checkChannel(userMessage, channelId, userId);
                    const channels = db.read('channels') || {};
                    const ch = channels[channelId] || {};
                    const mode = ch.mode || 'bot';

                    if (mode === 'pvp') {
                        await this.handlePvPResponse(message, response);
                    } else {
                        const embed = new EmbedBuilder()
                            .setDescription(response.message)
                            .setColor(response.type === 'success' ? 0x00FF00 : response.type === 'error' ? 0xFF0000 : 0x0099FF);
                        await message.reply({ embeds: [embed] });
                        if (response.currentWord) {
                            await message.channel.send(`Từ hiện tại: **${response.currentWord}**`);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error(`Error processing message: ${error.message}`);
            logger.error(`Stack: ${error.stack}`);
        }
    }

    async handlePvPResponse(message, response) {
        try {
            if (response.code === 'ok') {
                await message.react('✅');
            } else if (response.code === 'win') {
                await message.react('🏆');
                const embed = new EmbedBuilder()
                    .setDescription(response.message)
                    .setColor(0x00FF00);
                await message.reply({ embeds: [embed] });
                if (response.currentWord) {
                    await message.channel.send(`🎮 **Game mới bắt đầu!**\nTừ hiện tại: **${response.currentWord}**`);
                }
            } else if (response.code === 'mismatch') {
                await message.react('❌');
                await message.reply({ content: `${response.message}\nTừ hiện tại: **${response.currentWord}**`, ephemeral: true });
            } else if (response.code === 'repeated') {
                await message.react('🔴');
                await message.reply({ content: `Từ này đã được trả lời trước đó!\nTừ hiện tại: **${response.currentWord}**` });
            } else if (response.code === 'not_in_dict') {
                await message.react('❌');
                await message.reply({ content: `**Từ không có trong bộ từ điển!** Vui lòng thử lại.\nTừ hiện tại: **${response.currentWord}**`, ephemeral: true });
            } else if (response.code === 'invalid_format') {
                await message.react('⚠️');
                await message.reply({ content: `${response.message}\nTừ hiện tại: **${response.currentWord}**`, ephemeral: true });
            } else {
                await message.react('ℹ️');
            }
        } catch (e) {
            logger.error(`Failed to react in PvP mode: ${e.message}`);
        }
    }

    async start(token) {
        try {
            await this.client.login(token);
        } catch (error) {
            logger.error('Failed to start Discord bot:', error);
            throw error;
        }
    }
}

module.exports = DiscordBot;