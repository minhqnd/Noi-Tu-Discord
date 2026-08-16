const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActivityType, ChannelType, Partials, PermissionFlagsBits } = require('discord.js');
const { setupLogger, GAME_CONSTANTS, PERMISSIONS } = require('./utils');
const gameLogic = require('./gameLogic');
const db = require('./db');

const logger = setupLogger('discord_bot');
const OWNER_ID = process.env.OWNER_ID;
const COMMAND_CONTEXTS = {
    GUILD: 0,
    BOT_DM: 1
};
const COMMAND_PERMISSIONS = {
    MANAGE_GUILD: (1n << 5n).toString()
};

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
        this.dictionaryCooldowns = new Map();
        this.permissionAlertCooldowns = new Map();

        this.setupEventHandlers();
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

        // Định kỳ cập nhật trạng thái bot mỗi 1 phút
        setInterval(() => this.updateBotStatus(), 1 * 60 * 1000);

        logger.info(`${this.client.user.tag} is now running!`);
    }

    getCommands() {
        return [
            {
                name: 'noitu_add',
                description: 'Thêm phòng game nối từ',
                default_member_permissions: COMMAND_PERMISSIONS.MANAGE_GUILD,
                contexts: [COMMAND_CONTEXTS.GUILD]
            },
            {
                name: 'noitu_remove',
                description: 'Xóa phòng game nối từ',
                default_member_permissions: COMMAND_PERMISSIONS.MANAGE_GUILD,
                contexts: [COMMAND_CONTEXTS.GUILD]
            },
            {
                name: 'help',
                description: 'Hiển thị trợ giúp của bot',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'tratu',
                description: 'Tra cứu từ điển tiếng việt',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM],
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
                description: 'Reset nối từ - bắt đầu game mới',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'stats',
                description: 'Xem thống kê nối từ hiện tại',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'botstats',
                description: 'Xem thống kê toàn hệ thống của Bot Nối Từ',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'feedback',
                description: 'Gửi phản hồi về từ thiếu, lỗi hoặc đề xuất',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'addword',
                description: '[OWNER] Thêm từ mới vào từ điển',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM],
                options: [
                    {
                        name: 'word',
                        description: 'Từ hoặc danh sách từ ngăn cách bởi dấu phẩy (vd: con chó, con mèo)',
                        type: 3, // STRING
                        required: true
                    }
                ]
            },
            // {
            //     name: 'viewfeedback',
            //     description: '[ADMIN] Xem tất cả phản hồi từ người dùng',
            //     contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            // },
            {
                name: 'noitu_mode',
                description: 'Chọn chế độ chơi cho kênh: bot hoặc pvp',
                default_member_permissions: COMMAND_PERMISSIONS.MANAGE_GUILD,
                contexts: [COMMAND_CONTEXTS.GUILD],
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
        try {
            if (!this.client?.user) return;
            const globalStats = db.getGlobalStats();
            const totalGames = (globalStats.total_games || 0).toLocaleString('vi-VN');
            const totalWordsGuessed = (globalStats.total_words_guessed || 0).toLocaleString('vi-VN');

            this.client.user.setPresence({
                activities: [{
                    name: '🎮 Nối từ Tiếng Việt',
                    type: ActivityType.Playing,
                    state: `Đã chơi ${totalWordsGuessed} lượt cùng mọi người <3`,
                }],
                status: 'online'
            });
        } catch (error) {
            logger.error(`Error updating bot status: ${error.message}`);
        }
    }

    // Helper function to check if channel is DM
    isDirectMessage(channel) {
        if (!channel) {
            return false;
        }
        return channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM;
    }

    getChannelAllowlist() {
        return db.read('channelAllowlist') || [];
    }

    saveChannelAllowlist(channelAllowlist) {
        db.store('channelAllowlist', channelAllowlist);
    }

    isChannelAllowed(channelId) {
        return this.getChannelAllowlist().includes(channelId.toString());
    }

    hasGuildManagementPermission(interaction) {
        return interaction.member?.permissions?.has(PERMISSIONS.MANAGE_GUILD) ||
            interaction.member?.permissions?.has(PERMISSIONS.ADMINISTRATOR);
    }

    hasFeedbackModerationPermission(interaction) {
        return interaction.member?.permissions?.has(PERMISSIONS.MODERATE_MEMBERS) ||
            interaction.member?.permissions?.has(PERMISSIONS.ADMINISTRATOR) ||
            interaction.member?.permissions?.has(PERMISSIONS.MANAGE_MESSAGES) ||
            interaction.member?.permissions?.has(PERMISSIONS.MANAGE_GUILD);
    }

    async replyNoPermission(interaction, content) {
        const payload = { content, ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => { });
            return;
        }
        await interaction.reply(payload).catch(() => { });
    }

    async replyInteractionError(interaction) {
        const payload = {
            content: 'Có lỗi xảy ra khi xử lý lệnh. Vui lòng thử lại sau.',
            ephemeral: true
        };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => { });
            return;
        }
        await interaction.reply(payload).catch(() => { });
    }

    checkDictionaryCooldown(userId) {
        const now = Date.now();
        const availableAt = this.dictionaryCooldowns.get(userId) || 0;
        if (availableAt > now) {
            return Math.ceil((availableAt - now) / 1000);
        }

        const nextAvailableAt = now + GAME_CONSTANTS.DICTIONARY_LOOKUP_COOLDOWN_MS;
        this.dictionaryCooldowns.set(userId, nextAvailableAt);
        const timer = setTimeout(() => {
            if ((this.dictionaryCooldowns.get(userId) || 0) <= Date.now()) {
                this.dictionaryCooldowns.delete(userId);
            }
        }, GAME_CONSTANTS.DICTIONARY_LOOKUP_COOLDOWN_MS);
        timer.unref?.();
        return 0;
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

    getMissingPermissions(channel, requiredFlags = null) {
        if (!channel || !channel.guild || !channel.permissionsFor) {
            return [];
        }

        const botUser = this.client.user;
        if (!botUser) return [];

        let permissions = null;
        try {
            permissions = channel.permissionsFor(botUser);
        } catch {
            return [];
        }
        if (!permissions) return [];

        const allPermissions = [
            { flag: PermissionFlagsBits.ViewChannel, name: 'Xem Kênh (View Channel)' },
            { flag: PermissionFlagsBits.SendMessages, name: 'Gửi Tin Nhắn (Send Messages)' },
            { flag: PermissionFlagsBits.EmbedLinks, name: 'Nhúng Liên Kết (Embed Links)' },
            { flag: PermissionFlagsBits.ReadMessageHistory, name: 'Xem Lịch Sử Tin Nhắn (Read Message History)' },
            { flag: PermissionFlagsBits.AddReactions, name: 'Thêm Biểu Cảm (Add Reactions)' }
        ];

        const targetPermissions = requiredFlags
            ? allPermissions.filter(p => requiredFlags.includes(p.flag))
            : allPermissions;

        return targetPermissions
            .filter(perm => !permissions.has(perm.flag))
            .map(perm => perm.name);
    }

    async notifyMissingPermissions(message, missingPermissions = null) {
        if (!message || !message.channel) return;

        const channelId = message.channel.id.toString();
        const now = Date.now();
        const lastAlert = this.permissionAlertCooldowns.get(channelId) || 0;
        // Giới hạn tần suất thông báo (cooldown 60s mỗi kênh) để tránh spam
        if (now - lastAlert < 60_000) {
            return;
        }
        this.permissionAlertCooldowns.set(channelId, now);

        const missingList = (missingPermissions && missingPermissions.length > 0)
            ? missingPermissions
            : this.getMissingPermissions(message.channel);

        const guildName = message.guild ? message.guild.name : 'Server';
        const channelMention = `<#${channelId}>`;

        const missingText = missingList.length > 0
            ? missingList.map(p => `• ❌ **${p}**`).join('\n')
            : '• ❌ **Gửi Tin Nhắn (Send Messages)** hoặc **Nhúng Liên Kết (Embed Links)**';

        const warningText = `⚠️ **[Lỗi Quyền Hạn]** Bot Nối Từ không có đủ quyền để hoạt động trong kênh ${channelMention} (Server: **${guildName}**)!\n\n` +
            `**Các quyền còn thiếu:**\n${missingText}\n\n` +
            `👉 **Cách khắc phục:** Vui lòng nhờ Quản trị viên/Admin server kiểm tra và cấp các quyền trên cho Bot hoặc Role của Bot trong Cài đặt Kênh/Server.`;

        // 1. Thử gửi tin nhắn thông báo ra kênh chat (dùng text thuần không cần EmbedLinks)
        try {
            await message.channel.send(warningText);
        } catch (channelError) {
            logger.warn(`Could not send permission warning to channel ${channelId}: ${channelError.message}`);
            // 2. Nếu không gửi được ra kênh chat (do thiếu SendMessages, ViewChannel,...), gửi DM riêng cho người nhắn
            if (message.author && !message.author.bot) {
                try {
                    await message.author.send(warningText);
                } catch (dmError) {
                    logger.warn(`Could not send permission warning to user ${message.author.tag || message.author.id} via DM: ${dmError.message}`);
                }
            }
        }
    }

    async onInteractionCreate(interaction) {
        const commandName = interaction.isCommand() ? interaction.commandName : interaction.customId;

        try {
            if (interaction.isCommand()) {
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
                    case 'botstats':
                        await this.handleBotStats(interaction);
                        break;
                    case 'feedback':
                        await this.handleFeedback(interaction);
                        break;
                    case 'addword':
                        await this.handleAddWord(interaction);
                        break;
                    case 'viewfeedback':
                        await this.handleViewFeedback(interaction);
                        break;
                    case 'noitu_mode':
                        await this.handleNoituMode(interaction);
                        break;
                }
            } else if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'select_feedback') {
                    await this.handleSelectFeedback(interaction);
                } else if (interaction.customId === 'select_feedback_type') {
                    await this.handleSelectFeedbackType(interaction);
                }
            } else if (interaction.isButton()) {
                if (interaction.customId.startsWith('reply_feedback_')) {
                    await this.handleReplyFeedbackButton(interaction);
                } else if (interaction.customId.startsWith('quick_word_added_')) {
                    await this.handleQuickWordAddedButton(interaction);
                } else if (interaction.customId.startsWith('userreply_')) {
                    await this.handleUserReplyButton(interaction);
                } else if (interaction.customId.startsWith('edit_feedback_')) {
                    await this.handleResolveFeedback(interaction);
                } else if (interaction.customId.startsWith('delete_feedback_')) {
                    await this.handleDeleteFeedback(interaction);
                } else if (interaction.customId === 'back_to_feedback_list') {
                    await this.handleBackToFeedbackList(interaction);
                }
            } else if (interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('feedback_modal_')) {
                    await this.handleFeedbackModalSubmit(interaction);
                } else if (interaction.customId.startsWith('reply_modal_')) {
                    await this.handleReplyModalSubmit(interaction);
                } else if (interaction.customId.startsWith('userreply_modal_')) {
                    await this.handleUserReplyModalSubmit(interaction);
                }
            }
        } catch (error) {
            logger.error(`Error handling interaction ${commandName}:`, error);
            await this.replyInteractionError(interaction);
        }
    }

    async handleNoituAdd(interaction) {
        if (this.isDirectMessage(interaction.channel)) {
            await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        if (!this.hasGuildManagementPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn cần quyền Manage Server để thêm phòng game.');
            return;
        }

        const channelId = interaction.channel.id.toString();
        const channelAllowlist = this.getChannelAllowlist();
        if (channelAllowlist.includes(channelId)) {
            await interaction.reply({ content: '> **Phòng hiện tại đã có trong cơ sở dữ liệu!**', ephemeral: false });
        } else {
            channelAllowlist.push(channelId);
            this.saveChannelAllowlist(channelAllowlist);
            const newWord = gameLogic.resetChannelGame(channelId);
            const missingPerms = this.getMissingPermissions(interaction.channel);
            let replyContent = `> **Đã thêm phòng game nối từ, MoiChat sẽ trả lời mọi tin nhắn từ phòng này!**\n\n🎮 **Game mới đã bắt đầu!**\nTừ hiện tại: **${newWord}**`;
            if (missingPerms.length > 0) {
                replyContent += `\n\n⚠️ **Lưu ý: Bot đang thiếu một số quyền trong kênh này:**\n` +
                    missingPerms.map(p => `• ❌ **${p}**`).join('\n') +
                    `\nVui lòng cấp các quyền trên để Bot hoạt động đầy đủ tính năng!`;
            }
            await interaction.reply({
                content: replyContent,
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
        if (!this.hasGuildManagementPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn cần quyền Manage Server để xóa phòng game.');
            return;
        }

        const channelId = interaction.channel.id.toString();
        const channelAllowlist = this.getChannelAllowlist();
        if (channelAllowlist.includes(channelId)) {
            this.saveChannelAllowlist(channelAllowlist.filter(id => id !== channelId));
            const channels = db.read('channels') || {};
            if (channels[channelId]) {
                delete channels[channelId];
                db.replace('channels', channels);
            }
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
                    value: '`/tratu [từ]` - Tra cứu từ điển\n`/botstats` - Xem thống kê toàn hệ thống của bot\n`/feedback` - Gửi phản hồi (từ thiếu, lỗi, đề xuất)\n`/noitu_mode [bot|pvp]` - Đặt chế độ chơi của kênh\n`/help` - Hiển thị hướng dẫn này',
                    inline: false
                },
                {
                    name: '🎮 Cách chơi',
                    value: 'Nhập từ gồm 2 chữ.\n• Chế độ bot: bot sẽ đưa ra từ tiếp theo.\n• Chế độ PvP: bot chỉ kiểm tra và thả reaction (✅ đúng, ❌ sai/ko có từ, 🔴 đã lặp, ⚠️ sai format).\n• Từ không có trong từ điển sẽ được coi là sai.',
                    inline: false
                },
                {
                    name: '⚠️ Lưu ý',
                    value: 'Nếu gặp lỗi hoặc từ còn thiếu, hãy dùng `/feedback` để báo cho chúng mình nhé!',
                    inline: false
                }
            )
            .setFooter({ text: 'Tạo bởi @minhqnd - Game nối từ Tiếng Việt' })
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
        if ((word || '').trim().length > GAME_CONSTANTS.DICTIONARY_LOOKUP_MAX_WORD_LENGTH) {
            await interaction.reply({
                content: `Từ tra cứu không được vượt quá ${GAME_CONSTANTS.DICTIONARY_LOOKUP_MAX_WORD_LENGTH} ký tự.`,
                ephemeral: true
            });
            return;
        }
        const retryAfter = this.checkDictionaryCooldown(interaction.user.id);
        if (retryAfter > 0) {
            await interaction.reply({
                content: `⏳ Vui lòng chờ ${retryAfter}s trước khi tra tiếp.`,
                ephemeral: true
            });
            return;
        }
        try {
            await interaction.deferReply();
            const responses = await gameLogic.tratu(word || 'từ');
            const embed = new EmbedBuilder()
                .setTitle('📖 Từ điển Tiếng Việt')
                .setDescription(responses)
                .setFooter({ text: 'Nguồn: dict.minhqnd.com' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });

            const currentWord = this.getCurrentWord(interaction);
            if (currentWord) {
                await interaction.channel.send(`Từ hiện tại: **${currentWord}**`);
            }
            logger.info(`${interaction.user.tag} tra từ '${(word || 'từ').trim()}'`);
        } catch (e) {
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'Không thể tra từ lúc này, vui lòng thử lại sau.' });
                } else {
                    await interaction.reply({ content: 'Không thể tra từ lúc này, vui lòng thử lại sau.' });
                }
            } catch { }
            logger.error(`Tratu failed for '${(word || '').trim()}': ${e.message}`);
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
            if (this.isChannelAllowed(channelId)) {
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

    async handleBotStats(interaction) {
        try {
            const globalStats = db.getGlobalStats();
            const totalServers = this.client.guilds.cache.size;
            const totalActiveChannels = this.getChannelAllowlist().length;
            const totalPlayers = db.getTotalTrackedPlayers();
            const totalGames = globalStats.total_games || 0;
            const totalWordsGuessed = globalStats.total_words_guessed || 0;
            const totalWrongGuesses = globalStats.total_wrong_guesses || 0;

            const embed = new EmbedBuilder()
                .setTitle('📊 Thống Kê Toàn Hệ Thống - Bot Nối Từ')
                .setColor(0x5865F2)
                .setDescription('Tổng hợp các chỉ số hoạt động của bot theo thời gian thực:')
                .addFields(
                    { name: '🌐 Máy chủ (Servers)', value: `**${totalServers.toLocaleString('vi-VN')}** server`, inline: true },
                    { name: '💬 Kênh đang chơi', value: `**${totalActiveChannels.toLocaleString('vi-VN')}** phòng`, inline: true },
                    { name: '👥 Tổng người chơi', value: `**${totalPlayers.toLocaleString('vi-VN')}** người`, inline: true },
                    { name: '🎮 Tổng ván đã bắt đầu', value: `**${totalGames.toLocaleString('vi-VN')}** ván`, inline: true },
                    { name: '📝 Tổng từ đã nối đúng', value: `**${totalWordsGuessed.toLocaleString('vi-VN')}** từ`, inline: true },
                    { name: '❌ Tổng lượt đoán sai', value: `**${totalWrongGuesses.toLocaleString('vi-VN')}** lần`, inline: true }
                )
                .setFooter({ text: 'Bot Nối Từ Tiếng Việt 🎮' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            logger.error(`Error in handleBotStats: ${error.message}`);
            await interaction.reply({ content: '❌ Có lỗi xảy ra khi lấy thống kê bot.', ephemeral: true }).catch(() => { });
        }
    }

    async handleAddWord(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({
                content: '❌ Lệnh này chỉ dành riêng cho OWNER bot.',
                ephemeral: true
            });
            return;
        }

        const inputWord = interaction.options.getString('word');
        const result = gameLogic.addWord(inputWord);

        if (result.success) {
            const addedCount = result.added?.length || 1;
            const embed = new EmbedBuilder()
                .setTitle(`✅ Đã thêm ${addedCount} từ mới vào từ điển!`)
                .setColor(0x57F287)
                .setFooter({ text: 'Đã lưu vào customWords.json' })
                .setTimestamp();

            let desc = `Các từ sau đã được thêm và có hiệu lực ngay lập tức:\n${result.added.map(w => `• **${w}**`).join('\n')}`;

            if (result.existing && result.existing.length > 0) {
                desc += `\n\n⚠️ **Đã có sẵn (${result.existing.length}):** ${result.existing.map(w => `"${w}"`).join(', ')}`;
            }
            if (result.invalid && result.invalid.length > 0) {
                desc += `\n\n❌ **Không hợp lệ (${result.invalid.length}):** ${result.invalid.map(w => `"${w}"`).join(', ')} *(phải gồm 2 âm tiết)*`;
            }

            embed.setDescription(desc.substring(0, 4096));

            await interaction.reply({ embeds: [embed], ephemeral: true });
            logger.info(`Owner ${interaction.user.tag} added words: ${result.added.join(', ')}`);
        } else {
            let errorMsg = '❌ Không thể thêm từ:\n';
            if (result.existing && result.existing.length > 0) {
                errorMsg += `⚠️ **Đã có sẵn trong từ điển:** ${result.existing.map(w => `"${w}"`).join(', ')}\n`;
            }
            if (result.invalid && result.invalid.length > 0) {
                errorMsg += `❌ **Không hợp lệ (phải gồm 2 âm tiết):** ${result.invalid.map(w => `"${w}"`).join(', ')}\n`;
            }
            if (!result.existing?.length && !result.invalid?.length) {
                errorMsg += result.message || 'Lỗi không xác định.';
            }

            await interaction.reply({
                content: errorMsg.trim(),
                ephemeral: true
            });
        }
    }

    async handleFeedback(interaction) {
        // Rate limit: 1 feedback per user per 5 minutes
        const userId = interaction.user.id;
        if (!this._feedbackCooldowns) this._feedbackCooldowns = new Map();
        const lastFeedback = this._feedbackCooldowns.get(userId);
        if (lastFeedback) {
            const elapsed = Math.floor((Date.now() - lastFeedback) / 1000);
            const remaining = 300 - elapsed;
            if (remaining > 0) {
                await interaction.reply({ content: `⏳ Vui lòng chờ ${Math.ceil(remaining / 60)} phút trước khi gửi feedback tiếp.`, ephemeral: true });
                return;
            }
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

        if (!this.hasFeedbackModerationPermission(interaction)) {
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
        if (!this.hasGuildManagementPermission(interaction)) {
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
        if (!this.hasFeedbackModerationPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn không có quyền xem phản hồi.');
            return;
        }

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
        if (!this.hasFeedbackModerationPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn không có quyền xử lý phản hồi.');
            return;
        }

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
        if (!this.hasFeedbackModerationPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn không có quyền xóa phản hồi.');
            return;
        }

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
        if (!this.hasFeedbackModerationPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn không có quyền xem phản hồi.');
            return;
        }

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

    async handleReplyFeedbackButton(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể trả lời.', ephemeral: true });
            return;
        }

        const parts = interaction.customId.split('_');
        const targetUserId = parts[2];
        const feedbackId = parts[3];
        const messageId = interaction.message?.id || '';

        const modal = new ModalBuilder()
            .setCustomId(`reply_modal_${targetUserId}_${feedbackId}_${messageId}`)
            .setTitle('Trả lời phản hồi');

        const replyInput = new TextInputBuilder()
            .setCustomId('reply_content')
            .setLabel('Nội dung tin nhắn gửi đến người dùng')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Nhập câu trả lời của bạn...')
            .setRequired(true)
            .setMaxLength(2000);

        const row = new ActionRowBuilder().addComponents(replyInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
    }

    async handleReplyModalSubmit(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Bạn không có quyền thực hiện.', ephemeral: true });
            return;
        }

        const parts = interaction.customId.split('_');
        const targetUserId = parts[2];
        const feedbackId = parts[3];
        const messageId = parts[4];
        const replyContent = interaction.fields.getTextInputValue('reply_content');

        try {
            await interaction.deferReply({ ephemeral: true });

            const targetUser = await this.client.users.fetch(targetUserId);
            if (!targetUser) {
                await interaction.editReply({ content: '❌ Không tìm thấy người dùng này trên Discord.' });
                return;
            }

            // Save reply to conversation history
            const feedbacks = gameLogic.getAllFeedbacks();
            const feedback = feedbacks.find(f => f.id === feedbackId);
            if (feedback) {
                if (!feedback.replies) feedback.replies = [];
                feedback.replies.push({ from: 'admin', content: replyContent, timestamp: new Date().toISOString() });
                gameLogic.saveFeedbacks(feedbacks);
            }

            // Build conversation history embed
            const replyEmbed = this._buildConversationEmbed(feedback, replyContent, 'admin');

            // Add reply button for user
            const userReplyBtn = new ButtonBuilder()
                .setCustomId(`userreply_${feedbackId}`)
                .setLabel('Trả lời')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬');

            const row = new ActionRowBuilder().addComponents(userReplyBtn);

            await targetUser.send({ embeds: [replyEmbed], components: [row] });

            // Update original message in admin DM (keep clickable so admin can send more replies if needed)
            const repliedBtn = new ButtonBuilder()
                .setCustomId(`reply_feedback_${targetUserId}_${feedbackId}`)
                .setLabel('Đã trả lời')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('✅');

            const quickBtn = new ButtonBuilder()
                .setCustomId(`quick_word_added_${targetUserId}_${feedbackId}`)
                .setLabel('Đã thêm từ')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✨');

            const updatedRow = new ActionRowBuilder().addComponents(repliedBtn, quickBtn);

            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [updatedRow] });
                } else if (messageId && interaction.channel) {
                    const origMsg = await interaction.channel.messages.fetch(messageId);
                    if (origMsg) {
                        await origMsg.edit({ components: [updatedRow] });
                    }
                }
            } catch (msgErr) {
                logger.warn(`Could not update original feedback message: ${msgErr.message}`);
            }

            await interaction.editReply({ content: `✅ Đã gửi tin nhắn trả lời thành công tới **${targetUser.tag}**!` });
            logger.info(`Admin replied to feedback ${feedbackId} from user ${targetUserId}`);
        } catch (error) {
            logger.error(`Failed to send reply to user ${targetUserId}: ${error.message}`);
            if (error.code === 50007) {
                await interaction.editReply({ content: '❌ Không thể gửi DM cho người dùng này (họ đã tắt nhận DM từ người lạ / bot).' });
            } else {
                await interaction.editReply({ content: `❌ Gửi tin nhắn thất bại: ${error.message}` });
            }
        }
    }

    async handleQuickWordAddedButton(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        const parts = interaction.customId.split('_');
        const targetUserId = parts[3];
        const feedbackId = parts[4];
        const quickMessage = 'Từ bạn đóng góp đã được bổ sung và có hiệu lực ngay lập tức, chúc bạn chơi game vui vẻ ❤️';

        try {
            await interaction.deferReply({ ephemeral: true });

            const targetUser = await this.client.users.fetch(targetUserId);
            if (!targetUser) {
                await interaction.editReply({ content: '❌ Không tìm thấy người dùng này trên Discord.' });
                return;
            }

            // Save reply to conversation history
            const feedbacks = gameLogic.getAllFeedbacks();
            const feedback = feedbacks.find(f => f.id === feedbackId);
            if (feedback) {
                if (!feedback.replies) feedback.replies = [];
                feedback.replies.push({ from: 'admin', content: quickMessage, timestamp: new Date().toISOString() });
                feedback.status = 'resolved';
                gameLogic.saveFeedbacks(feedbacks);
            }

            // Build conversation history embed for the user
            const replyEmbed = this._buildConversationEmbed(feedback, quickMessage, 'admin');

            // Add reply button for user
            const userReplyBtn = new ButtonBuilder()
                .setCustomId(`userreply_${feedbackId}`)
                .setLabel('Trả lời')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬');

            const row = new ActionRowBuilder().addComponents(userReplyBtn);

            await targetUser.send({ embeds: [replyEmbed], components: [row] });

            // Update the original message in Admin DM (keep clickable so admin can send more replies if needed)
            const replyBtn = new ButtonBuilder()
                .setCustomId(`reply_feedback_${targetUserId}_${feedbackId}`)
                .setLabel('Trả lời')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬');

            const addedBtn = new ButtonBuilder()
                .setCustomId(`quick_word_added_${targetUserId}_${feedbackId}`)
                .setLabel('Đã báo thêm từ')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('✅');

            const updatedRow = new ActionRowBuilder().addComponents(replyBtn, addedBtn);

            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [updatedRow] });
                }
            } catch (msgErr) {
                logger.warn(`Could not update original feedback message: ${msgErr.message}`);
            }

            await interaction.editReply({ content: `✅ Đã gửi thông báo thêm từ thành công tới **${targetUser.tag}**!` });
            logger.info(`Admin sent quick word-added reply to feedback ${feedbackId} from user ${targetUserId}`);
        } catch (error) {
            logger.error(`Failed to send quick word-added reply to user ${targetUserId}: ${error.message}`);
            if (error.code === 50007) {
                await interaction.editReply({ content: '❌ Không thể gửi DM cho người dùng này (họ đã tắt nhận DM từ người lạ / bot).' });
            } else {
                await interaction.editReply({ content: `❌ Gửi tin nhắn thất bại: ${error.message}` });
            }
        }
    }

    async handleUserReplyButton(interaction) {
        const feedbackId = interaction.customId.replace('userreply_', '');

        const modal = new ModalBuilder()
            .setCustomId(`userreply_modal_${feedbackId}`)
            .setTitle('Trả lời Admin');

        const replyInput = new TextInputBuilder()
            .setCustomId('reply_content')
            .setLabel('Nội dung trả lời')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Nhập câu trả lời của bạn...')
            .setRequired(true)
            .setMaxLength(2000);

        const row = new ActionRowBuilder().addComponents(replyInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
    }

    async handleUserReplyModalSubmit(interaction) {
        const feedbackId = interaction.customId.replace('userreply_modal_', '');
        const replyContent = interaction.fields.getTextInputValue('reply_content');
        const userId = interaction.user.id;
        const username = interaction.user.tag;

        try {
            await interaction.deferReply({ ephemeral: true });

            // Save reply to conversation history
            const feedbacks = gameLogic.getAllFeedbacks();
            const feedback = feedbacks.find(f => f.id === feedbackId);
            if (feedback) {
                if (!feedback.replies) feedback.replies = [];
                feedback.replies.push({ from: 'user', content: replyContent, timestamp: new Date().toISOString() });
                gameLogic.saveFeedbacks(feedbacks);
            }

            // Send to admin with full conversation history
            const owner = await this.client.users.fetch(OWNER_ID);
            const historyEmbed = this._buildConversationEmbed(feedback, replyContent, 'user');

            const replyBtn = new ButtonBuilder()
                .setCustomId(`reply_feedback_${userId}_${feedbackId}`)
                .setLabel('Trả lời')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬');

            const quickAddBtn = new ButtonBuilder()
                .setCustomId(`quick_word_added_${userId}_${feedbackId}`)
                .setLabel('Đã thêm từ')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✨');

            const row = new ActionRowBuilder().addComponents(replyBtn, quickAddBtn);

            await owner.send({ embeds: [historyEmbed], components: [row] });

            await interaction.editReply({ content: '✅ Đã gửi trả lời tới Admin thành công!' });
            logger.info(`User ${username} replied to feedback ${feedbackId}`);
        } catch (error) {
            logger.error(`Failed to send user reply for feedback ${feedbackId}: ${error.message}`);
            await interaction.editReply({ content: '❌ Có lỗi xảy ra khi gửi trả lời. Vui lòng thử lại sau.' });
        }
    }

    _buildConversationEmbed(feedback, latestContent, latestFrom) {
        const embed = new EmbedBuilder()
            .setTitle(latestFrom === 'admin' ? '📩 Phản hồi từ Admin Bot Nối Từ' : '📬 Trả lời từ người dùng')
            .setColor(latestFrom === 'admin' ? 0x57F287 : 0xFFA500)
            .setFooter({ text: latestFrom === 'admin' ? 'Cảm ơn bạn đã đóng góp phát triển Bot Nối Từ 🐧' : `Feedback #${feedback?.id || 'N/A'}` })
            .setTimestamp();

        if (!feedback) {
            embed.setDescription(latestContent);
            return embed;
        }

        // Build conversation thread
        let history = '';

        // Original feedback
        history += `**📝 Phản hồi gốc** (${feedback.username}):\n> ${feedback.content.substring(0, 300)}\n\n`;

        // Previous replies
        if (feedback.replies && feedback.replies.length > 0) {
            // Show all replies except the latest one (which we'll highlight)
            const previousReplies = feedback.replies.slice(0, -1);
            for (const reply of previousReplies) {
                const label = reply.from === 'admin' ? '💬 Admin' : `👤 ${feedback.username}`;
                history += `**${label}:**\n> ${reply.content.substring(0, 300)}\n\n`;
            }
        }

        // Latest message (highlighted)
        const latestLabel = latestFrom === 'admin' ? '💬 Admin (mới nhất)' : `👤 ${feedback.username} (mới nhất)`;
        history += `**${latestLabel}:**\n${latestContent.substring(0, 500)}`;

        embed.setDescription(history.substring(0, 4000));
        embed.addFields({ name: 'Mã phản hồi', value: feedback.id || 'N/A', inline: true });

        if (latestFrom === 'user') {
            embed.addFields(
                { name: 'Từ', value: `${feedback.username} (${feedback.user_id})`, inline: true }
            );
        }

        return embed;
    }

    async handleFeedbackModalSubmit(interaction) {
        const feedbackType = interaction.customId.split('_').slice(2).join('_');
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

            // Set cooldown
            if (!this._feedbackCooldowns) this._feedbackCooldowns = new Map();
            this._feedbackCooldowns.set(userId, Date.now());

            // Send DM to owner with reply button
            try {
                const owner = await this.client.users.fetch(OWNER_ID);
                const dmEmbed = new EmbedBuilder()
                    .setTitle('📬 Feedback mới')
                    .setDescription(content)
                    .addFields(
                        { name: 'Loại', value: typeLabel, inline: true },
                        { name: 'Từ', value: `${username} (${userId})`, inline: true },
                        { name: 'Kênh', value: channelId || 'DM', inline: true },
                        { name: 'ID', value: feedbackId, inline: true }
                    )
                    .setColor(0xFFA500)
                    .setTimestamp();

                const replyBtn = new ButtonBuilder()
                    .setCustomId(`reply_feedback_${userId}_${feedbackId}`)
                    .setLabel('Trả lời')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('💬');

                const quickAddBtn = new ButtonBuilder()
                    .setCustomId(`quick_word_added_${userId}_${feedbackId}`)
                    .setLabel('Đã thêm từ')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✨');

                const row = new ActionRowBuilder().addComponents(replyBtn, quickAddBtn);

                await owner.send({ embeds: [dmEmbed], components: [row] });
            } catch (dmErr) {
                logger.warn(`Could not DM owner: ${dmErr.message}`);
            }

            logger.info(`Feedback received from ${username}: ${fullContent.length} chars`);
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
        const isDM = this.isDirectMessage(message.channel);

        try {
            if (isDM) {
                // Check if this is a first-time DM user (no existing game data)
                const users = db.read('users') || {};
                const existingUserData = users[userId];

                if (!existingUserData || !existingUserData.word) {
                    // First-time user: send welcome + start game
                    const response = gameLogic.checkUser(userMessage, userId);

                    const welcomeEmbed = new EmbedBuilder()
                        .setTitle('👋 Chào mừng bạn đến với Nối Từ!')
                        .setDescription(
                            'Đây là game **nối từ tiếng Việt** — bạn và bot thay phiên nối từ gồm **2 âm tiết**.\n\n' +
                            '**Luật chơi:**\n' +
                            '• Từ của bạn phải bắt đầu bằng **chữ cuối** của từ trước đó\n' +
                            '• Mỗi từ gồm đúng **2 âm tiết** (ví dụ: "xanh lục", "lục bình")\n' +
                            '• Không được lặp lại từ đã dùng\n\n' +
                            '**Lệnh hữu ích:**\n' +
                            '• `/newgame` — Bắt đầu ván mới\n' +
                            '• `/stats` — Xem thống kê của bạn\n' +
                            '• `/tratu [từ]` — Tra cứu từ điển\n' +
                            '• `/feedback` — Gửi phản hồi nếu bạn thấy từ bị thiếu'
                        )
                        .setColor(0x57F287)
                        .setFooter({ text: 'Bot Nối Từ 🐧 | Hãy bắt đầu nối từ nhé!' });

                    await message.reply({ embeds: [welcomeEmbed] });

                    if (response.currentWord) {
                        await message.channel.send(`Từ bắt đầu: **${response.currentWord}**\nHãy nối tiếp bằng từ bắt đầu bởi **"${response.currentWord.split(' ').pop()}"** nhé!`);
                    }
                    return;
                }

                const response = gameLogic.checkUser(userMessage, userId);
                const embed = new EmbedBuilder()
                    .setDescription(response.message)
                    .setColor(response.type === 'success' ? 0x00FF00 : response.type === 'error' ? 0xFF0000 : 0x0099FF);
                await message.reply({ embeds: [embed] });
                if (response.currentWord) {
                    await message.channel.send(`Từ hiện tại: **${response.currentWord}**`);
                }
            } else {
                if (this.isChannelAllowed(channelId)) {
                    const channels = db.read('channels') || {};
                    const ch = channels[channelId] || {};
                    const mode = ch.mode || 'bot';

                    const requiredFlags = mode === 'pvp'
                        ? [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AddReactions,
                            PermissionFlagsBits.EmbedLinks
                        ]
                        : [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ];

                    const missingPerms = this.getMissingPermissions(message.channel, requiredFlags);
                    if (missingPerms.length > 0) {
                        await this.notifyMissingPermissions(message, missingPerms);
                        return;
                    }

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
            if (error.code === 50013 || error.message?.includes('Missing Permissions')) {
                await this.notifyMissingPermissions(message);
            }
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
                await message.reply({ content: `${response.message}\nTừ hiện tại: **${response.currentWord}**` });
            } else if (response.code === 'repeated') {
                await message.react('❌');
                await message.reply({ content: `${response.message}\nTừ hiện tại: **${response.currentWord}**` });
            } else if (response.code === 'not_in_dict') {
                await message.react('❌');
                await message.reply({ content: `${response.message}\nTừ hiện tại: **${response.currentWord}**` });
            } else if (response.code === 'invalid_format') {
                await message.react('⚠️');
                await message.reply({ content: `${response.message}\nTừ hiện tại: **${response.currentWord}**` });
            } else {
                await message.react('ℹ️');
            }
        } catch (e) {
            logger.error(`Failed to react in PvP mode: ${e.message}`);
            if (e.code === 50013 || e.message?.includes('Missing Permissions')) {
                await this.notifyMissingPermissions(message);
            }
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
