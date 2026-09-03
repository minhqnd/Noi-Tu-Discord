const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActivityType, ChannelType, Partials, PermissionFlagsBits } = require('discord.js');
const { setupLogger, GAME_CONSTANTS, PERMISSIONS } = require('./utils');
const gameLogic = require('./gameLogic');
const db = require('./db');
const topggService = require('./topggService');

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

        // Welcome message when invited to a new server
        this.client.on('guildCreate', async (guild) => {
            await this.onGuildCreate(guild);
        });
    }

    async onGuildCreate(guild) {
        logger.info(`Bot joined a new server: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);

        try {
            const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
            if (!botMember) return;

            const canSendInChannel = (ch) => {
                if (!ch || !ch.isTextBased() || ch.isVoiceBased()) return false;
                const perms = ch.permissionsFor(botMember);
                return perms?.has(PermissionFlagsBits.ViewChannel) &&
                    perms?.has(PermissionFlagsBits.SendMessages) &&
                    perms?.has(PermissionFlagsBits.EmbedLinks);
            };

            let targetChannel = guild.systemChannel;
            if (!canSendInChannel(targetChannel)) {
                targetChannel = guild.channels.cache.find(ch => canSendInChannel(ch));
            }

            if (!targetChannel) {
                const channels = await guild.channels.fetch().catch(() => null);
                if (channels) {
                    targetChannel = channels.find(ch => canSendInChannel(ch));
                }
            }

            if (!targetChannel) {
                logger.warn(`Could not find a suitable channel to send welcome message in ${guild.name} (${guild.id})`);
                return;
            }

            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎉 Cảm ơn bạn đã mời Bot Nối Từ!')
                .setDescription(
                    'Xin chào! Cảm ơn bạn và server đã thêm Bot Nối Từ. Dưới đây là hướng dẫn nhanh để bắt đầu chơi:'
                )
                .addFields(
                    {
                        name: 'Bắt đầu chơi',
                        value: [
                            '`/noitu_add` - Thêm kênh làm phòng chơi nối từ (Admin)',
                            '`/noitu_mode` - Đổi chế độ chơi bất cứ lúc nào (Admin)',
                            '`/newgame` - Bắt đầu ván mới / bỏ qua từ khó',
                            'Hoặc nhắn tin riêng (DM) trực tiếp cho bot để chơi 1 mình.'
                        ].join('\n')
                    },
                    {
                        name: '2 Chế độ chơi',
                        value: [
                            '• **Chơi cùng Bot (Mặc định):** Người chơi nối tiếp từ cùng sự tham gia của Bot cho từ tiếp theo.',
                            '• **Đấu PvP (Người vs Người):** Các thành viên trong kênh tự do nối từ với nhau, Bot làm trọng tài kiểm tra từ, chấm điểm và ghi nhận chuỗi.'
                        ].join('\n')
                    },
                    {
                        name: 'Lệnh hữu ích',
                        value: [
                            '`/leaderboard` - Xem bảng xếp hạng người chơi',
                            '`/stats` - Xem thống kê cá nhân',
                            '`/tratu [từ]` - Tra cứu từ điển tiếng Việt',
                            '`/botstats` - Xem thống kê toàn hệ thống của bot',
                            '`/feedback` - Gửi phản hồi hoặc góp ý từ vựng mới',
                            '`/help` - Xem hướng dẫn đầy đủ'
                        ].join('\n')
                    },
                    {
                        name: 'Quyền hạn cần thiết',
                        value: 'Vui lòng đảm bảo Bot có đủ các quyền: **Xem kênh (View Channel)**, **Gửi tin nhắn (Send Messages)**, **Nhúng liên kết (Embed Links)** và **Thêm biểu cảm (Add Reactions)** để hoạt động tốt nhất.'
                    }
                )
                .setColor(0x57F287)
                .setFooter({ text: 'Bot Nối Từ 🐧 | Gõ /noitu_add để bắt đầu!' })
                .setTimestamp();

            await targetChannel.send({ embeds: [welcomeEmbed] });
            logger.info(`Sent welcome message to server ${guild.name} in channel #${targetChannel.name}`);
        } catch (error) {
            logger.error(`Error sending welcome message in guildCreate (${guild.name}): ${error.message}`);
        }
    }

    async onReady() {
        await this.client.application.commands.set(this.getCommands());
        this.updateBotStatus();

        // Định kỳ xoay vòng custom status (thought bubble) mỗi 30 giây
        setInterval(() => this.updateBotStatus(), 30 * 1000);

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
                name: 'hint',
                description: 'Nhận gợi ý từ nối tiếp (yêu cầu có lượt tích lũy & vote Top.gg)',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'stats',
                description: 'Xem thống kê nối từ hiện tại của bản thân',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM]
            },
            {
                name: 'leaderboard',
                description: 'Xem bảng xếp hạng người chơi (trong kênh hoặc toàn server)',
                contexts: [COMMAND_CONTEXTS.GUILD, COMMAND_CONTEXTS.BOT_DM],
                // options: [
                //     {
                //         name: 'type',
                //         description: 'Loại bảng xếp hạng (mặc định: Kỷ lục chuỗi)',
                //         type: 3, // STRING
                //         required: false,
                //         choices: [
                //             { name: 'Kỷ lục chuỗi (Best Streak)', value: 'streak' },
                //             { name: 'Số trận thắng (Wins)', value: 'wins' }
                //         ]
                //     }
                // ]
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
                contexts: [COMMAND_CONTEXTS.BOT_DM],
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
                description: 'Chọn chế độ chơi cho kênh: Chơi cùng Bot hoặc PvP',
                default_member_permissions: COMMAND_PERMISSIONS.MANAGE_GUILD,
                contexts: [COMMAND_CONTEXTS.GUILD],
                options: [
                    {
                        name: 'mode',
                        description: 'Chế độ chơi (tùy chọn: bot hoặc pvp, để trống để mở menu nút bấm)',
                        type: 3, // STRING
                        required: false,
                        choices: [
                            { name: 'Chơi cùng Bot (user vs bot)', value: 'bot' },
                            { name: 'Đấu PvP (user vs user)', value: 'pvp' }
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
            const correct = globalStats.total_words_guessed || 0;
            const wrong = globalStats.total_wrong_guesses || 0;
            const totalGuessed = (correct + wrong).toLocaleString('vi-VN');
            const serverCount = this.client.guilds?.cache?.size || 0;

            if (this._statusIndex === undefined) this._statusIndex = 0;

            // Danh sách status xoay vòng hiển thị trong thought bubble cạnh avatar
            const statuses = [
                `🎮 Đã nối ${totalGuessed} lượt <3`,
                '🐧 Bot Nối Từ Tiếng Việt',
                '💡 Gõ /help để xem hướng dẫn',
                `🌐 Có mặt ${serverCount} servers`,
                '⚔️ Cùng nhau nối từ!'
            ];

            const currentStatus = statuses[this._statusIndex % statuses.length];
            this._statusIndex++;

            this.client.user.setPresence({
                activities: [{
                    name: 'custom',
                    type: ActivityType.Custom,
                    state: currentStatus,
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
                    case 'hint':
                        await this.handleHint(interaction);
                        break;
                    case 'stats':
                        await this.handleStats(interaction);
                        break;
                    case 'leaderboard':
                        await this.handleLeaderboard(interaction);
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
                } else if (interaction.customId.startsWith('word_select_')) {
                    await this.handleWordSelectionChange(interaction);
                } else if (interaction.customId.startsWith('bulk_word_select')) {
                    await this.handleBulkWordSelect(interaction);
                }
            } else if (interaction.isButton()) {
                if (interaction.customId.startsWith('setup_mode_')) {
                    await this.handleSetupModeButton(interaction);
                } else if (interaction.customId.startsWith('set_mode_')) {
                    await this.handleSetModeButton(interaction);
                } else if (interaction.customId.startsWith('approve_words_') && !interaction.customId.startsWith('approve_words_done_')) {
                    await this.handleApproveWords(interaction);
                } else if (interaction.customId.startsWith('reject_words_') && !interaction.customId.startsWith('reject_words_done_')) {
                    await this.handleRejectAllWords(interaction);
                } else if (interaction.customId.startsWith('reply_feedback_')) {
                    await this.handleReplyFeedbackButton(interaction);
                } else if (interaction.customId.startsWith('quick_word_added_')) {
                    await this.handleQuickWordAddedButton(interaction);
                } else if (interaction.customId.startsWith('userreply_')) {
                    await this.handleUserReplyButton(interaction);
                } else if (interaction.customId.startsWith('edit_feedback_')) {
                    await this.handleResolveFeedback(interaction);
                } else if (interaction.customId.startsWith('delete_feedback_')) {
                    await this.handleDeleteFeedback(interaction);
                } else if (interaction.customId === 'bulk_review') {
                    await this.handleBulkReview(interaction);
                } else if (interaction.customId === 'bulk_approve') {
                    await this.handleBulkApprove(interaction);
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

    buildSetupPayload(channelId, missingPerms = []) {
        const embed = new EmbedBuilder()
            .setTitle('Cài Đặt Phòng Nối Từ')
            .setColor(0x57F287)
            .setDescription(`Thiết lập kênh <#${channelId}> làm phòng chơi nối từ.\n\nChọn chế độ chơi bên dưới để bắt đầu!`)
            .addFields(
                {
                    name: 'Chọn chế độ chơi',
                    value: [
                        '• **Chơi cùng Bot (Mặc định):** Người chơi nối từ trực tiếp với Bot (Bạn nối 1 từ ➔ Bot nối tiếp 1 từ).',
                        '• **Đấu PvP (Người vs Người):** Các thành viên trong server tự do nối từ với nhau. Bot làm trọng tài kiểm tra từ, chấm điểm và ghi nhận chuỗi.'
                    ].join('\n'),
                    inline: false
                }
            );

        if (missingPerms && missingPerms.length > 0) {
            embed.addFields({
                name: 'Lưu ý quyền hạn',
                value: `Bot đang thiếu một số quyền trong kênh này:\n` +
                    missingPerms.map(p => `• ${p}`).join('\n') +
                    `\nVui lòng cấp đủ quyền để Bot hoạt động tốt nhất.`,
                inline: false
            });
        }

        const botButton = new ButtonBuilder()
            .setCustomId(`setup_mode_bot_${channelId}`)
            .setLabel('Chơi cùng Bot')
            .setStyle(ButtonStyle.Primary);

        const pvpButton = new ButtonBuilder()
            .setCustomId(`setup_mode_pvp_${channelId}`)
            .setLabel('Đấu PvP (Người vs Người)')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(botButton, pvpButton);

        return {
            embeds: [embed],
            components: [row]
        };
    }

    buildModeSelectionPayload(channelId, currentMode = 'bot', currentWord = null, missingPerms = [], isAlreadyAdded = false) {
        const isBot = currentMode !== 'pvp';
        const modeLabel = isBot ? 'Chơi cùng Bot' : 'Đấu PvP (Người vs Người)';

        let descriptionText = `Kênh <#${channelId}> đã có trong danh sách phòng chơi.`;
        if (currentWord) {
            descriptionText += `\n\nTừ hiện tại: **${currentWord}**`;
        }

        const embed = new EmbedBuilder()
            .setTitle('Cài Đặt Phòng Nối Từ')
            .setColor(0x57F287)
            .setDescription(descriptionText)
            .addFields(
                {
                    name: 'Chọn chế độ chơi (Bấm nút bên dưới)',
                    value: [
                        '• **Chơi cùng Bot (Mặc định):** Người chơi nối từ với sự tham gia Bot cho từ tiếp theo (Bạn nối 1 từ ➔ Bot nối tiếp 1 từ).',
                        '• **Đấu PvP (Người vs Người):** Các thành viên trong server tự do nối từ với nhau. Bot làm trọng tài kiểm tra từ, chấm điểm và ghi nhận chuỗi.'
                    ].join('\n'),
                    inline: false
                }
            );

        if (missingPerms && missingPerms.length > 0) {
            embed.addFields({
                name: 'Lưu ý quyền hạn',
                value: `Bot đang thiếu một số quyền trong kênh này:\n` +
                    missingPerms.map(p => `• ${p}`).join('\n') +
                    `\nVui lòng cấp đủ quyền để Bot hoạt động tốt nhất.`,
                inline: false
            });
        }

        embed.setFooter({
            text: `Chế độ hiện tại: ${modeLabel} • Quản trị viên có thể bấm nút để đổi`
        });

        const botButton = new ButtonBuilder()
            .setCustomId(`set_mode_bot_${channelId}`)
            .setLabel(isBot ? 'Chơi cùng Bot (Đang chọn)' : 'Chơi cùng Bot')
            .setStyle(isBot ? ButtonStyle.Success : ButtonStyle.Secondary);

        const pvpButton = new ButtonBuilder()
            .setCustomId(`set_mode_pvp_${channelId}`)
            .setLabel(!isBot ? 'Đấu PvP (Đang chọn)' : 'Đấu PvP (Người vs Người)')
            .setStyle(!isBot ? ButtonStyle.Success : ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(botButton, pvpButton);

        return {
            embeds: [embed],
            components: [row]
        };
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
            // Already added — show current status with mode selection
            const channels = db.read('channels') || {};
            const channelData = channels[channelId] || {};
            const currentMode = channelData.mode || 'bot';
            const currentWord = this.getCurrentWord(interaction);
            const missingPerms = this.getMissingPermissions(interaction.channel);
            const payload = this.buildModeSelectionPayload(channelId, currentMode, currentWord, missingPerms, true);
            await interaction.reply({ ...payload, ephemeral: false });
        } else {
            // Not added yet — show setup UI, do NOT add to allowlist yet
            const missingPerms = this.getMissingPermissions(interaction.channel);
            const payload = this.buildSetupPayload(channelId, missingPerms);
            await interaction.reply({ ...payload, ephemeral: false });
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
            .setTitle('Bot Nối Từ Tiếng Việt - Hướng dẫn sử dụng')
            .setDescription('Game nối từ tiếng Việt 2 âm tiết — so tài từ vựng và thi đấu chuỗi nối từ!')
            .setColor(0x57F287)
            .addFields(
                {
                    name: 'Lệnh Chơi Game & Quản Lý Kênh',
                    value: [
                        '`/noitu_add` — Thêm phòng nối từ & chọn chế độ qua 2 nút bấm *(Admin)*',
                        '`/noitu_mode` — Chuyển chế độ (Chơi cùng Bot / Đấu PvP) qua nút bấm *(Admin)*',
                        '`/noitu_remove` — Xóa phòng nối từ *(Admin)*',
                        '`/newgame` — Bắt đầu ván mới / Bỏ qua từ hiện tại',
                        '`/hint` — Gợi ý từ nối tiếp (tích lũy từ chuỗi & vote Top.gg)'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Thống Kê & Bảng Xếp Hạng',
                    value: [
                        '`/leaderboard` — Xem bảng xếp hạng Top 10 *(theo chuỗi hoặc số trận thắng)*',
                        '`/stats` — Xem kỷ lục và thống kê cá nhân của bạn',
                        '`/botstats` — Xem thống kê hoạt động toàn hệ thống của bot'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Tiện Ích & Đóng Góp',
                    value: [
                        '`/tratu [từ]` — Tra cứu định nghĩa từ điển tiếng Việt',
                        '`/feedback` — Đóng góp từ còn thiếu, báo lỗi hoặc đề xuất tính năng',
                        '`/help` — Hiển thị bảng hướng dẫn này'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Luật Chơi Nhanh',
                    value: '• Mỗi từ gồm đúng **2 âm tiết** (ví dụ: `học hỏi`, `hỏi han`).\n• Từ nối phải bắt đầu bằng **âm tiết cuối** của từ trước đó.\n• **Chế độ Bot:** Bạn và Bot thay phiên nối từ.\n• **Chế độ PvP:** Các thành viên trong kênh tự do nối từ với nhau.',
                    inline: false
                }
            )
            .setFooter({ text: 'Bot Nối Từ | Chúc bạn chơi game vui vẻ!' })
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
            const context = { isDM: true, userName: interaction.user.username };
            const newWord = gameLogic.resetUserGame(userId, context);
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
                            const context = {
                                guildName: interaction.guild?.name || 'Server',
                                channelName: interaction.channel?.name || channelId,
                                userName: interaction.user.username
                            };
                            const newWord = gameLogic.resetChannelGame(channelId, context);
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

    async handleHint(interaction) {
        const userId = interaction.user.id;
        const isDM = this.isDirectMessage(interaction.channel);
        const channelId = interaction.channel?.id?.toString();
        const location = isDM ? 'DM' : `${interaction.guild?.name || 'Server'} > #${interaction.channel?.name || channelId}`;

        logger.info(`[Hint] User @${interaction.user.username} (${userId}) executed /hint in [${location}]`);

        // Check channel allowlist if not DM
        if (!isDM && !this.isChannelAllowed(channelId)) {
            return await interaction.reply({
                content: '> **Kênh này chưa được thêm vào game nối từ!** Hãy nhờ Quản trị viên dùng lệnh `/noitu_add` để bắt đầu.',
                ephemeral: true
            });
        }

        // Get game hint
        const hintResult = gameLogic.getHint(channelId, userId, isDM);
        if (!hintResult.success) {
            return await interaction.reply({
                content: `> ${hintResult.message}`,
                ephemeral: true
            });
        }

        let userHints = db.getUserHints(userId);
        const voteUrl = topggService.getVoteUrl();
        const voteCheck = await topggService.checkUserVote(userId);
        let voteClaimed = db.getUserVoteClaimed(userId);
        let claimedVoteBonus = false;

        if (!voteCheck.hasVoted) {
            // Khi Top.gg đã hết chu kỳ 12h (voted = 0), reset cờ để sẵn sàng nhận thưởng cho lần vote kế tiếp
            if (voteClaimed) {
                db.setUserVoteClaimed(userId, 0);
                voteClaimed = 0;
            }
        } else {
            // Top.gg báo đã vote: nếu chưa nhận thưởng của lượt vote này thì cộng ngay +1 lượt
            if (!voteClaimed) {
                db.addUserHint(userId, 1, GAME_CONSTANTS.MAX_HINTS);
                db.setUserVoteClaimed(userId, 1);
                userHints = db.getUserHints(userId);
                claimedVoteBonus = true;
                logger.info(`[Hint] User @${interaction.user.username} (${userId}) claimed +1 vote reward. Hints now: ${userHints}`);
            }
        }

        // Case 1: User has 0 hints in inventory
        if (userHints < 1) {
            logger.info(`[Hint] User @${interaction.user.username} (${userId}) has 0 hints (voted: ${voteCheck.hasVoted})`);
            if (!voteCheck.hasVoted) {
                // Chưa vote: Kêu gọi vote ngay để nhận +1 lượt
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('🗳️ Vote ngay để nhận +1 lượt')
                        .setStyle(ButtonStyle.Link)
                        .setURL(voteUrl)
                );

                return await interaction.reply({
                    content: [
                        '💡 **Bạn chưa có lượt gợi ý nào!**',
                        `> Lượt gợi ý hiện tại của bạn: **0/${GAME_CONSTANTS.MAX_HINTS}** lượt.`,
                        '> - **Vote cho Bot trên Top.gg ngay** để được nhận **+1 lượt gợi ý** miễn phí!',
                        `> - Hoặc cứ mỗi mốc **10 từ nối đúng** được thưởng **+1 lượt gợi ý** (tối đa ${GAME_CONSTANTS.MAX_HINTS} lượt).`
                    ].join('\n'),
                    components: [row],
                    ephemeral: true
                });
            } else {
                // Đã vote rồi (và đã dùng hết lượt trong 12h này)
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('🌟 Vote Bot trên Top.gg')
                        .setStyle(ButtonStyle.Link)
                        .setURL(voteUrl)
                );

                return await interaction.reply({
                    content: [
                        '💡 **Bạn chưa có lượt gợi ý nào!**',
                        `> Lượt gợi ý hiện tại của bạn: **0/${GAME_CONSTANTS.MAX_HINTS}** lượt.`,
                        '> - Hôm nay bạn đã vote rồi! Vui lòng quay lại **Vote sau mỗi 12 tiếng** để nhận thêm **+1 lượt gợi ý** nhé.',
                        `> - Trong lúc chờ, bạn có thể cày chuỗi: cứ mỗi mốc **10 từ nối đúng** trong chuỗi sẽ được thưởng **+1 lượt gợi ý**!`
                    ].join('\n'),
                    components: [row],
                    ephemeral: true
                });
            }
        }

        // Case 2: User has >= 1 hints, check Top.gg vote status
        if (!voteCheck.hasVoted) {
            logger.info(`[Hint] User @${interaction.user.username} (${userId}) has ${userHints} hints but has not voted on Top.gg`);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🗳️ Vote ngay trên Top.gg')
                    .setStyle(ButtonStyle.Link)
                    .setURL(voteUrl)
            );

            return await interaction.reply({
                content: [
                    '🔒 **Lượt gợi ý chưa dùng được!**',
                    `> Bạn đang có **${userHints}/${GAME_CONSTANTS.MAX_HINTS}** lượt gợi ý sẵn sàng trong kho.`,
                    '> - Để sử dụng gợi ý, bạn cần **Vote cho bot trên Top.gg**.',
                    '',
                    '👉 **Bấm nút bên dưới để Vote**, sau đó quay lại gõ lệnh `/hint` để nhận gợi ý nhé!'
                ].join('\n'),
                components: [row],
                ephemeral: true
            });
        }

        // Case 3: User has hints AND has voted on Top.gg
        db.useUserHint(userId);
        const remainingHints = db.getUserHints(userId);

        const words = hintResult.suggestedWords || [hintResult.suggestedWord];
        const wordsFormatted = words.map(w => `> - **${w}**`).join('\n');

        logger.info(`[Hint] User @${interaction.user.username} (${userId}) used hint for '${hintResult.currentWord}': [${words.join(', ')}]. Remaining: ${remainingHints}`);

        const replyLines = [
            // '💡 **GỢI Ý TỪ NỐI TIẾP:**',
            ` Từ hiện tại: **${hintResult.currentWord}**`,
            ` Bạn có thể nối tiếp bằng một trong các từ sau:`,
            wordsFormatted,
            '',
            `- Bạn còn lại **${remainingHints}/${GAME_CONSTANTS.MAX_HINTS}** lượt gợi ý.`
        ];

        if (claimedVoteBonus) {
            replyLines.push('-# 🎉 Cảm ơn bạn đã Vote ủng hộ bot!');
        }

        return await interaction.reply({
            content: replyLines.join('\n'),
            ephemeral: true
        });
    }

    async handleStats(interaction) {
        const userId = interaction.user.id;
        const hints = db.getUserHints(userId);
        let voteBadge = '⏳ Đang kiểm tra...';
        try {
            const voteCheck = await topggService.checkUserVote(userId);
            voteBadge = voteCheck.hasVoted ? '✅ Đã Vote' : '❌ Chưa Vote';
        } catch (e) {
            voteBadge = '❓ Chưa kiểm tra';
        }
        const hintLine = `> Lượt gợi ý: **${hints}/${GAME_CONSTANTS.MAX_HINTS}**`;

        if (this.isDirectMessage(interaction.channel)) {
            const users = db.read('users') || {};
            const dataUser = users[userId] || { word: null, history: [], currentStreak: 0, bestStreak: 0, wins: 0, wrongCount: 0 };
            const heading = `Thống kê của ${interaction.user}`;
            const stats = `> Chuỗi hiện tại: **${dataUser.currentStreak || 0}** | Cao nhất: **${dataUser.bestStreak || 0}** | Thắng: **${dataUser.wins || 0}**`;
            await interaction.reply({ content: `${heading}\n${stats}\n${hintLine}`, ephemeral: false });

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
            await interaction.reply({ content: `${heading}\n${stats}\n${hintLine}`, ephemeral: false });

            if (ch.word) {
                await interaction.channel.send(`Từ hiện tại: **${ch.word}**`);
            }
        }
    }

    async handleLeaderboard(interaction) {
        let playerList = [];
        const isDM = this.isDirectMessage(interaction.channel);
        const type = interaction.options.getString('type') || 'streak';

        if (isDM) {
            // Lấy toàn bộ channel từ db và gộp lại cho global leaderboard
            const channels = db.read('channels') || {};
            const globalPlayers = {};

            for (const chId in channels) {
                const ch = channels[chId];
                if (!ch.players) continue;

                for (const uid in ch.players) {
                    const stats = ch.players[uid];
                    if (!globalPlayers[uid]) {
                        globalPlayers[uid] = {
                            userId: uid,
                            currentStreak: 0,
                            bestStreak: 0,
                            wins: 0
                        };
                    }
                    globalPlayers[uid].bestStreak = Math.max(globalPlayers[uid].bestStreak, stats.bestStreak || 0);
                    globalPlayers[uid].currentStreak = Math.max(globalPlayers[uid].currentStreak, stats.currentStreak || 0);
                    globalPlayers[uid].wins += (stats.wins || 0);
                }
            }

            playerList = Object.values(globalPlayers).filter(p => p.bestStreak > 0 || p.wins > 0 || p.currentStreak > 0);
        } else {
            const channelId = interaction.channel.id.toString();
            const channels = db.read('channels') || {};
            const ch = channels[channelId] || {};
            const players = ch.players || {};

            playerList = Object.entries(players).map(([uid, stats]) => ({
                userId: uid,
                currentStreak: stats.currentStreak || 0,
                bestStreak: stats.bestStreak || 0,
                wins: stats.wins || 0
            })).filter(p => p.bestStreak > 0 || p.wins > 0 || p.currentStreak > 0);
        }

        if (playerList.length === 0) {
            await interaction.reply({
                content: `🏆 **Chưa có ai ghi danh trên bảng xếp hạng ${isDM ? 'toàn máy chủ' : 'của kênh này'}!**\nHãy bắt đầu nối từ để ghi điểm nhé 🎮`,
                ephemeral: false
            });
            return;
        }

        // Sắp xếp
        if (type === 'wins') {
            playerList.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return b.bestStreak - a.bestStreak;
            });
        } else {
            playerList.sort((a, b) => {
                if (b.bestStreak !== a.bestStreak) return b.bestStreak - a.bestStreak;
                return b.wins - a.wins;
            });
        }

        const top10 = playerList.slice(0, 10);
        const medals = ['🥇', '🥈', '🥉'];

        const rankLines = await Promise.all(top10.map(async (player, idx) => {
            const badge = idx < 3 ? medals[idx] : `\`#${idx + 1}\``;
            let displayName = `<@${player.userId}>`;

            if (isDM) {
                try {
                    const u = await this.client.users.fetch(player.userId);
                    displayName = `**${u.username}**`;
                } catch (e) {
                    displayName = `ID: ${player.userId}`;
                }
            }

            if (type === 'wins') {
                return `${badge} ${displayName}\n┗ 🏆 Thắng: **${player.wins}** | Kỷ lục: **${player.bestStreak}** | Chuỗi hiện tại: **${player.currentStreak}**`;
            }
            return `${badge} ${displayName}\n┗ 🔥 Kỷ lục: **${player.bestStreak}** từ | Thắng: **${player.wins}** 🏆 | Chuỗi hiện tại: **${player.currentStreak}**`;
        }));

        const myRankIndex = playerList.findIndex(p => p.userId === interaction.user.id);
        const myStats = myRankIndex !== -1 ? playerList[myRankIndex] : null;

        const title = `🏆 BẢNG XẾP HẠNG ${type === 'wins' ? 'SỐ TRẬN THẮNG' : 'KỶ LỤC CHUỖI'} — ${isDM ? 'TOÀN MÁY CHỦ' : '#' + interaction.channel.name}`;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(rankLines.join('\n\n'))
            .setColor(0xFEE75C)
            .setFooter({ text: `Tổng cộng ${playerList.length} người chơi • Bot Nối Từ 🐧` })
            .setTimestamp();

        if (myStats) {
            const myBadge = myRankIndex < 3 ? medals[myRankIndex] : `#${myRankIndex + 1}`;
            embed.addFields({
                name: `👤 Thứ hạng của bạn ${isDM ? 'toàn máy chủ' : 'trong kênh'}`,
                value: `Thứ hạng: **${myBadge}** / ${playerList.length}\n🔥 Kỷ lục: **${myStats.bestStreak}** | 🏆 Thắng: **${myStats.wins}** | Chuỗi: **${myStats.currentStreak}**`,
                inline: false
            });
        } else {
            embed.addFields({
                name: `👤 Thứ hạng của bạn ${isDM ? 'toàn máy chủ' : 'trong kênh'}`,
                value: `Bạn chưa có điểm ${isDM ? 'trên toàn máy chủ' : 'trong phòng này'}. Hãy nối đúng từ để ghi danh nhé!`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
        logger.info(`User ${interaction.user.tag} viewed leaderboard in ${isDM ? 'DM (Global)' : '#' + interaction.channel.name} [type=${type}]`);
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
        // Rate limit: 1 feedback per user per 20 seconds
        const userId = interaction.user.id;
        if (!this._feedbackCooldowns) this._feedbackCooldowns = new Map();
        const lastFeedback = this._feedbackCooldowns.get(userId);
        if (lastFeedback) {
            const elapsed = Math.floor((Date.now() - lastFeedback) / 1000);
            const remaining = 20 - elapsed;
            if (remaining > 0) {
                await interaction.reply({ content: `⏳ Vui lòng chờ ${remaining} giây trước khi gửi feedback tiếp.`, ephemeral: true });
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
            await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong kênh server.', ephemeral: true });
            return;
        }
        if (!this.hasGuildManagementPermission(interaction)) {
            await this.replyNoPermission(interaction, '❌ Bạn cần quyền Manage Server để đổi chế độ.');
            return;
        }

        const channelId = interaction.channel.id.toString();
        const channelAllowlist = this.getChannelAllowlist();
        let isAlreadyAdded = true;

        if (!channelAllowlist.includes(channelId)) {
            isAlreadyAdded = false;
            channelAllowlist.push(channelId);
            this.saveChannelAllowlist(channelAllowlist);
            const context = {
                guildName: interaction.guild?.name || 'Server',
                channelName: interaction.channel?.name || channelId,
                userName: interaction.user.username
            };
            gameLogic.resetChannelGame(channelId, context);
        }

        const modeOption = interaction.options.getString('mode');
        const channels = db.read('channels') || {};
        const ch = channels[channelId] || {};

        if (modeOption) {
            ch.mode = modeOption;
            channels[channelId] = ch;
            db.store('channels', channels);
            logger.info(`Admin ${interaction.user.tag || interaction.user.id} đã đổi mode phòng ${channelId} sang ${modeOption}`);
        }

        const currentMode = ch.mode || 'bot';
        const currentWord = ch.word || this.getCurrentWord(interaction);
        const missingPerms = this.getMissingPermissions(interaction.channel);

        const payload = this.buildModeSelectionPayload(channelId, currentMode, currentWord, missingPerms, isAlreadyAdded);
        await interaction.reply({ ...payload, ephemeral: false });
    }

    async handleSetupModeButton(interaction) {
        if (!this.hasGuildManagementPermission(interaction)) {
            await interaction.reply({
                content: '❌ Chỉ thành viên có quyền **Manage Server (Quản lý máy chủ)** mới có thể thiết lập phòng chơi.',
                ephemeral: true
            });
            return;
        }

        const isPvP = interaction.customId.startsWith('setup_mode_pvp_');
        const targetMode = isPvP ? 'pvp' : 'bot';
        const targetChannelId = interaction.customId.replace(isPvP ? 'setup_mode_pvp_' : 'setup_mode_bot_', '');

        // Add channel to allowlist
        const channelAllowlist = this.getChannelAllowlist();
        if (!channelAllowlist.includes(targetChannelId)) {
            channelAllowlist.push(targetChannelId);
            this.saveChannelAllowlist(channelAllowlist);
        }

        // Set mode and start game
        const context = {
            guildName: interaction.guild?.name || 'Server',
            channelName: interaction.channel?.name || targetChannelId,
            userName: interaction.user.username
        };
        const currentWord = gameLogic.resetChannelGame(targetChannelId, context);

        // Set mode
        const channels = db.read('channels') || {};
        const ch = channels[targetChannelId] || {};
        ch.mode = targetMode;
        channels[targetChannelId] = ch;
        db.store('channels', channels);

        const modeLabel = targetMode === 'pvp' ? '**Đấu PvP (Người vs Người)**' : '**Chơi cùng Bot**';

        // Update the setup embed to show completed setup
        const missingPerms = interaction.channel ? this.getMissingPermissions(interaction.channel) : [];
        const payload = this.buildModeSelectionPayload(targetChannelId, targetMode, currentWord, missingPerms, true);
        await interaction.update(payload);

        await interaction.followUp({
            content: `Đã thiết lập kênh <#${targetChannelId}> với chế độ ${modeLabel}.\nTừ bắt đầu: **${currentWord}**`,
            ephemeral: false
        });

        logger.info(`Setup phòng ${targetChannelId} — mode: ${targetMode}, từ bắt đầu: ${currentWord}`);
    }

    async handleSetModeButton(interaction) {
        if (!this.hasGuildManagementPermission(interaction)) {
            await interaction.reply({
                content: '❌ Chỉ thành viên có quyền **Manage Server (Quản lý máy chủ)** mới có thể thay đổi chế độ chơi.',
                ephemeral: true
            });
            return;
        }

        const isPvP = interaction.customId.startsWith('set_mode_pvp_');
        const targetMode = isPvP ? 'pvp' : 'bot';
        const targetChannelId = interaction.customId.replace(isPvP ? 'set_mode_pvp_' : 'set_mode_bot_', '');

        const channelAllowlist = this.getChannelAllowlist();
        if (!channelAllowlist.includes(targetChannelId)) {
            channelAllowlist.push(targetChannelId);
            this.saveChannelAllowlist(channelAllowlist);
            const context = {
                guildName: interaction.guild?.name || 'Server',
                channelName: interaction.channel?.name || targetChannelId,
                userName: interaction.user.username
            };
            gameLogic.resetChannelGame(targetChannelId, context);
        }

        const channels = db.read('channels') || {};
        const ch = channels[targetChannelId] || {};
        const oldMode = ch.mode || 'bot';

        ch.mode = targetMode;
        channels[targetChannelId] = ch;
        db.store('channels', channels);

        const currentWord = ch.word || (interaction.channel?.id === targetChannelId ? this.getCurrentWord(interaction) : null);
        const missingPerms = interaction.channel ? this.getMissingPermissions(interaction.channel) : [];

        const payload = this.buildModeSelectionPayload(targetChannelId, targetMode, currentWord, missingPerms, true);
        await interaction.update(payload);

        if (oldMode !== targetMode) {
            const modeLabel = targetMode === 'pvp' ? '**Đấu PvP (Người vs Người)**' : '**Chơi cùng Bot**';
            await interaction.followUp({
                content: `Quản trị viên <@${interaction.user.id}> đã chuyển chế độ chơi phòng này sang ${modeLabel}.${currentWord ? `\nTừ hiện tại: **${currentWord}**` : ''}`,
                ephemeral: false
            });
            logger.info(`Admin ${interaction.user.tag || interaction.user.id} đã đổi mode phòng ${targetChannelId} sang ${targetMode}`);
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

        const placeholders = {
            missing_word: 'Bắt buộc: từ 2 âm tiết, cách nhau bằng dấu phẩy. VD: khô cá, khô bò, bình minh',
            bug: 'Mô tả lỗi bạn gặp phải: lỗi gì, khi nào xảy ra...',
            feature_request: 'Mô tả tính năng bạn muốn đề xuất...'
        };

        const modal = new ModalBuilder()
            .setCustomId(`feedback_modal_${feedbackType}`)
            .setTitle('Gửi phản hồi');

        const contentInput = new TextInputBuilder()
            .setCustomId('feedback_content')
            .setLabel(feedbackType === 'missing_word' ? 'Từ còn thiếu (mỗi từ đúng 2 âm tiết)' : 'Nội dung phản hồi')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(placeholders[feedbackType] || 'Mô tả chi tiết phản hồi của bạn...')
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
        const rawContent = interaction.fields.getTextInputValue('feedback_content');
        const content = rawContent ? rawContent.trim() : '';

        const userId = interaction.user.id;
        const username = interaction.user.tag;
        const channelId = this.isDirectMessage(interaction.channel) ? null : interaction.channel.id;

        const typeLabels = {
            missing_word: 'Từ còn thiếu',
            bug: 'Lỗi',
            feature_request: 'Đóng góp tính năng'
        };

        const typeLabel = typeLabels[feedbackType] || 'Khác';

        // Check if content is empty
        if (!content) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Nội dung không hợp lệ')
                .setDescription('Nội dung phản hồi không được để trống.')
                .setColor(0xED4245);
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Strict format validation for missing_word
        if (feedbackType === 'missing_word') {
            const rawItems = content.split(/[,，;\n]+/).map(s => s.trim()).filter(Boolean);
            const validWords = [];
            const invalidItems = [];

            for (const rawItem of rawItems) {
                const normalized = gameLogic.normalizeVietnamese(rawItem);
                const parts = normalized.split(/\s+/);
                const isLettersOnly = /^[\p{L}\s]+$/u.test(rawItem);

                if (parts.length === 2 && isLettersOnly) {
                    validWords.push(normalized);
                } else {
                    invalidItems.push(rawItem);
                }
            }

            if (rawItems.length === 0 || invalidItems.length > 0) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Sai format yêu cầu')
                    .setDescription('Phản hồi đóng góp từ **bắt buộc phải theo đúng format** và chưa được gửi đi.')
                    .setColor(0xED4245)
                    .setTimestamp();

                if (invalidItems.length > 0) {
                    const invalidList = invalidItems.slice(0, 10).map(s => `• \`${s.substring(0, 50)}\``).join('\n');
                    const remaining = invalidItems.length - 10;
                    embed.addFields({
                        name: '⚠️ Các mục không đúng format',
                        value: invalidList + (remaining > 0 ? `\n... và ${remaining} mục khác` : ''),
                        inline: false
                    });
                }

                embed.addFields({
                    name: '💡 Quy tắc format bắt buộc',
                    value: '• Mỗi từ phải gồm **đúng 2 âm tiết** (tiếng Việt có nghĩa)\n' +
                        '• Các từ phân cách nhau bằng **dấu phẩy** (`,`) hoặc **xuống dòng**\n' +
                        '• Không gửi kèm chữ số hay ký tự đặc biệt\n\n' +
                        '**Ví dụ đúng:** `khô cá, khô bò, bình minh`',
                    inline: false
                });

                await interaction.reply({ embeds: [embed], ephemeral: true });
                return;
            }
        } else if (content.length < 5) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Nội dung quá ngắn')
                .setDescription('Vui lòng mô tả chi tiết hơn (tối thiểu 5 ký tự) để chúng tôi có thể hỗ trợ.')
                .setColor(0xED4245);
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const fullContent = `[${typeLabel}] ${content}`;

        try {
            const feedbackId = gameLogic.storeFeedback(userId, username, fullContent, channelId);

            let description = `Cảm ơn bạn đã gửi phản hồi! Chúng tôi sẽ xem xét và cải thiện.\n\n**Loại:** ${typeLabel}\n**ID phản hồi:** ${feedbackId}`;

            if (feedbackType === 'missing_word') {
                const rawItems = content.split(/[,，;\n]+/).map(s => s.trim()).filter(Boolean);
                const uniqueWords = [...new Set(rawItems.map(item => gameLogic.normalizeVietnamese(item)))];
                description += `\n\n📋 Đã nhận diện **${uniqueWords.length}** từ hợp lệ: ${uniqueWords.map(w => `\`${w}\``).join(', ')}. Admin sẽ xem xét và duyệt sớm!`;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Phản hồi đã được gửi')
                .setDescription(description)
                .setColor(0x00FF00)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

            // Set cooldown only upon successful feedback submission
            if (!this._feedbackCooldowns) this._feedbackCooldowns = new Map();
            this._feedbackCooldowns.set(userId, Date.now());

            // Send DM to owner
            try {
                const owner = await this.client.users.fetch(OWNER_ID);

                if (feedbackType === 'missing_word') {
                    // Auto-parse words from content for missing_word feedback
                    await this._sendParsedWordFeedbackDM(owner, content, userId, username, channelId, feedbackId, typeLabel);
                } else {
                    // Default DM for other feedback types
                    await this._sendDefaultFeedbackDM(owner, content, userId, username, channelId, feedbackId, typeLabel);
                }
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

    /**
     * Parse words from feedback content and send DM to admin with select menu + approve/reject buttons
     */
    async _sendParsedWordFeedbackDM(owner, content, userId, username, channelId, feedbackId, typeLabel) {
        // Parse words: split by comma, newline, or semicolon
        const rawItems = content.split(/[,，;\n]+/).map(s => s.trim()).filter(Boolean);
        const parsedWords = [];
        const invalidItems = [];

        for (const rawItem of rawItems) {
            const normalized = gameLogic.normalizeVietnamese(rawItem);
            const parts = normalized.split(/\s+/);
            const isLettersOnly = /^[\p{L}\s]+$/u.test(rawItem);
            if (parts.length === 2 && isLettersOnly) {
                if (!parsedWords.includes(normalized)) {
                    parsedWords.push(normalized);
                }
            } else {
                invalidItems.push(rawItem);
            }
        }

        if (parsedWords.length > 0) {
            // Build enhanced DM with select menu
            const dmEmbed = new EmbedBuilder()
                .setTitle('📬 Feedback mới — Từ còn thiếu')
                .setDescription(content)
                .addFields(
                    { name: 'Từ hợp lệ', value: parsedWords.map(w => `• **${w}**`).join('\n').substring(0, 1024), inline: false },
                    { name: 'Từ', value: `${username} (${userId})`, inline: true },
                    { name: 'Kênh', value: channelId || 'DM', inline: true },
                    { name: 'ID', value: feedbackId, inline: true }
                )
                .setColor(0xFFA500)
                .setTimestamp();

            if (invalidItems.length > 0) {
                dmEmbed.addFields({
                    name: '⚠️ Không hợp lệ (bỏ qua)',
                    value: invalidItems.map(w => `• ${w}`).join('\n').substring(0, 1024),
                    inline: false
                });
            }

            const components = [];

            // Select menu for choosing words to approve (max 25 options)
            const selectOptions = parsedWords.slice(0, 25).map(word => ({
                label: word,
                value: word,
                default: true // All selected by default
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`word_select_${feedbackId}`)
                .setPlaceholder('Chọn từ muốn duyệt (mặc định chọn hết)')
                .setMinValues(0)
                .setMaxValues(selectOptions.length)
                .addOptions(selectOptions);

            components.push(new ActionRowBuilder().addComponents(selectMenu));

            // Buttons row 1: approve/reject/reply
            const approveBtn = new ButtonBuilder()
                .setCustomId(`approve_words_${userId}_${feedbackId}`)
                .setLabel(`✅ Duyệt từ đã chọn (${parsedWords.length})`)
                .setStyle(ButtonStyle.Success);

            const rejectBtn = new ButtonBuilder()
                .setCustomId(`reject_words_${userId}_${feedbackId}`)
                .setLabel('❌ Từ chối tất cả')
                .setStyle(ButtonStyle.Danger);

            const replyBtn = new ButtonBuilder()
                .setCustomId(`reply_feedback_${userId}_${feedbackId}`)
                .setLabel('💬 Trả lời')
                .setStyle(ButtonStyle.Primary);

            const bulkBtn = new ButtonBuilder()
                .setCustomId('bulk_review')
                .setLabel('📋 Duyệt tổng')
                .setStyle(ButtonStyle.Secondary);

            components.push(new ActionRowBuilder().addComponents(approveBtn, rejectBtn, replyBtn, bulkBtn));

            // Store parsed words for later retrieval
            if (!this._pendingWordApprovals) this._pendingWordApprovals = new Map();
            this._pendingWordApprovals.set(feedbackId, {
                allWords: parsedWords,
                selectedWords: [...parsedWords], // Default: all selected
                userId,
                username
            });

            await owner.send({ embeds: [dmEmbed], components });
        } else {
            // No valid words parsed — fallback to default DM
            await this._sendDefaultFeedbackDM(owner, content, userId, username, channelId, feedbackId, typeLabel);
        }
    }

    /**
     * Send default feedback DM to admin (for non-word feedback types or when parsing fails)
     */
    async _sendDefaultFeedbackDM(owner, content, userId, username, channelId, feedbackId, typeLabel) {
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
    }

    /**
     * Handle word selection change from admin select menu
     */
    async handleWordSelectionChange(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        const feedbackId = interaction.customId.replace('word_select_', '');
        const selectedWords = interaction.values; // Array of selected word values

        if (!this._pendingWordApprovals) this._pendingWordApprovals = new Map();
        const pending = this._pendingWordApprovals.get(feedbackId);
        if (pending) {
            pending.selectedWords = selectedWords;
        }

        // Rebuild components with updated select menu defaults and button label
        const components = interaction.message.components.map((row, index) => {
            if (index === 0) {
                // Select menu row — rebuild with updated default states
                const allWords = pending ? pending.allWords : [];
                const selectOptions = allWords.slice(0, 25).map(word => ({
                    label: word,
                    value: word,
                    default: selectedWords.includes(word)
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`word_select_${feedbackId}`)
                    .setPlaceholder('Chọn từ muốn duyệt')
                    .setMinValues(0)
                    .setMaxValues(selectOptions.length)
                    .addOptions(selectOptions);

                return new ActionRowBuilder().addComponents(selectMenu);
            }
            if (index === 1) {
                // Buttons row — update approve button label
                const newRow = ActionRowBuilder.from(row);
                const approveBtn = newRow.components[0];
                if (approveBtn && approveBtn.data.custom_id?.startsWith('approve_words_')) {
                    const updatedBtn = ButtonBuilder.from(approveBtn)
                        .setLabel(`✅ Duyệt từ đã chọn (${selectedWords.length})`);
                    newRow.components[0] = updatedBtn;
                }
                return newRow;
            }
            return ActionRowBuilder.from(row);
        });

        await interaction.update({ components });
    }

    /**
     * Handle "Duyệt từ đã chọn" button — auto addWord + notify user
     */
    async handleApproveWords(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        const parts = interaction.customId.split('_');
        const targetUserId = parts[2];
        const feedbackId = parts[3];

        if (!this._pendingWordApprovals) this._pendingWordApprovals = new Map();
        const pending = this._pendingWordApprovals.get(feedbackId);

        if (!pending || pending.selectedWords.length === 0) {
            await interaction.reply({ content: '⚠️ Không có từ nào được chọn để duyệt.', ephemeral: true });
            return;
        }

        try {
            await interaction.deferUpdate();

            // Add words using gameLogic.addWord (accepts comma-separated string)
            const wordsToAdd = pending.selectedWords.join(', ');
            const result = gameLogic.addWord(wordsToAdd);

            // Build result summary
            let resultDesc = '';
            if (result.success && result.added?.length > 0) {
                resultDesc += `✅ **Đã thêm (${result.added.length}):** ${result.added.map(w => `**${w}**`).join(', ')}\n`;
            }
            if (result.existing?.length > 0) {
                resultDesc += `⚠️ **Đã có sẵn (${result.existing.length}):** ${result.existing.join(', ')}\n`;
            }
            if (result.invalid?.length > 0) {
                resultDesc += `❌ **Không hợp lệ (${result.invalid.length}):** ${result.invalid.join(', ')}\n`;
            }

            const totalApproved = (result.added?.length || 0);
            const totalSelected = pending.selectedWords.length;
            const totalAll = pending.allWords.length;

            // Update admin embed
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setTitle(`📬 Feedback — Đã duyệt ${totalApproved}/${totalAll} từ`)
                .setColor(0x57F287);

            if (resultDesc) {
                updatedEmbed.addFields({ name: '📊 Kết quả duyệt', value: resultDesc.substring(0, 1024), inline: false });
            }

            // Disable all buttons
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`approve_words_done_${feedbackId}`)
                    .setLabel(`✅ Đã duyệt ${totalApproved} từ`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`reject_words_done_${feedbackId}`)
                    .setLabel('❌ Từ chối')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`reply_feedback_${targetUserId}_${feedbackId}`)
                    .setLabel('💬 Trả lời')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.editReply({ embeds: [updatedEmbed], components: [disabledRow] });

            // Notify user via DM if words were added
            if (totalApproved > 0) {
                try {
                    const targetUser = await this.client.users.fetch(targetUserId);
                    const userEmbed = new EmbedBuilder()
                        .setTitle('✅ Từ của bạn đã được thêm vào từ điển!')
                        .setDescription('Cảm ơn bạn đã đóng góp, từ đã được thêm và có hiệu lực ngay lập tức, chúc bạn chơi game vui vẻ <3')
                        .setColor(0x57F287)
                        .setFooter({ text: 'Bot Nối Từ 🐧' })
                        .setTimestamp();

                    const userReplyBtn = new ButtonBuilder()
                        .setCustomId(`userreply_${feedbackId}`)
                        .setLabel('Trả lời')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('💬');

                    const userRow = new ActionRowBuilder().addComponents(userReplyBtn);
                    await targetUser.send({ embeds: [userEmbed], components: [userRow] });
                } catch (userDmErr) {
                    logger.warn(`Could not DM user ${targetUserId}: ${userDmErr.message}`);
                }
            }

            // Mark feedback as resolved
            const feedbacks = gameLogic.getAllFeedbacks();
            const feedback = feedbacks.find(f => f.id === feedbackId);
            if (feedback) {
                feedback.status = 'resolved';
                if (!feedback.replies) feedback.replies = [];
                feedback.replies.push({
                    from: 'admin',
                    content: 'Cảm ơn bạn đã đóng góp, từ đã được thêm và có hiệu lực ngay lập tức, chúc bạn chơi game vui vẻ <3',
                    timestamp: new Date().toISOString()
                });
                gameLogic.saveFeedbacks(feedbacks);
            }

            // Clean up pending state
            this._pendingWordApprovals.delete(feedbackId);

            logger.info(`Admin approved ${totalApproved}/${totalAll} words from feedback ${feedbackId}`);
        } catch (error) {
            logger.error(`Failed to approve words for feedback ${feedbackId}: ${error.message}`);
            try {
                await interaction.followUp({ content: `❌ Lỗi khi duyệt từ: ${error.message}`, ephemeral: true });
            } catch (e) {
                // ignore follow-up errors
            }
        }
    }

    /**
     * Handle "Từ chối tất cả" button
     */
    async handleRejectAllWords(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        const parts = interaction.customId.split('_');
        const targetUserId = parts[2];
        const feedbackId = parts[3];

        try {
            // Update admin embed
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setTitle('📬 Feedback — Đã từ chối tất cả')
                .setColor(0xED4245);

            // Disable all buttons
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`approve_words_done_${feedbackId}`)
                    .setLabel('✅ Duyệt')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`reject_words_done_${feedbackId}`)
                    .setLabel('❌ Đã từ chối')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`reply_feedback_${targetUserId}_${feedbackId}`)
                    .setLabel('💬 Trả lời')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });

            // Mark feedback as resolved
            const feedbacks = gameLogic.getAllFeedbacks();
            const feedback = feedbacks.find(f => f.id === feedbackId);
            if (feedback) {
                feedback.status = 'resolved';
                gameLogic.saveFeedbacks(feedbacks);
            }

            // Clean up pending state
            if (this._pendingWordApprovals) {
                this._pendingWordApprovals.delete(feedbackId);
            }

            logger.info(`Admin rejected all words from feedback ${feedbackId}`);
        } catch (error) {
            logger.error(`Failed to reject words for feedback ${feedbackId}: ${error.message}`);
            await interaction.reply({ content: `❌ Lỗi: ${error.message}`, ephemeral: true });
        }
    }

    /**
     * Handle "Duyệt tổng" button — aggregate all pending missing_word feedbacks
     */
    async handleBulkReview(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        try {
            const feedbacks = gameLogic.getAllFeedbacks();
            const pendingWordFeedbacks = feedbacks.filter(
                f => f.status === 'pending' && f.content.startsWith('[Từ còn thiếu]')
            );

            if (pendingWordFeedbacks.length === 0) {
                await interaction.reply({ content: '📭 Không có feedback "Từ còn thiếu" nào đang chờ duyệt.', ephemeral: true });
                return;
            }

            // Collect feedbacks and words in batches (max 25 words due to Discord SelectMenu limit)
            const wordMap = new Map(); // word -> { users: [{ userId, username, feedbackId }] }
            const batchWords = [];
            const batchFeedbacks = [];

            for (const fb of pendingWordFeedbacks) {
                const rawContent = fb.content.replace('[Từ còn thiếu] ', '');
                const rawItems = rawContent.split(/[,，;\n]+/).map(s => s.trim()).filter(Boolean);
                const fbWords = [];

                for (const rawItem of rawItems) {
                    const normalized = gameLogic.normalizeVietnamese(rawItem);
                    const parts = normalized.split(/\s+/);
                    if (parts.length === 2) {
                        fbWords.push(normalized);
                    }
                }

                if (fbWords.length === 0) {
                    // Empty or non 2-word feedback: include in batch so it doesn't block the pending queue
                    batchFeedbacks.push(fb);
                    continue;
                }

                // Check how many new unique words this feedback would introduce
                const newWords = fbWords.filter(w => !wordMap.has(w));

                // If adding this feedback exceeds 25 words, leave it for the next batch
                if (batchWords.length > 0 && batchWords.length + newWords.length > 25) {
                    break;
                }

                batchFeedbacks.push(fb);
                for (const w of fbWords) {
                    if (!wordMap.has(w)) {
                        if (batchWords.length >= 25) break;
                        wordMap.set(w, { users: [] });
                        batchWords.push(w);
                    }
                    const entry = wordMap.get(w);
                    if (entry && !entry.users.find(u => u.userId === fb.userId && u.feedbackId === fb.id)) {
                        entry.users.push({ userId: fb.userId, username: fb.username, feedbackId: fb.id });
                    }
                }
            }

            if (batchWords.length === 0) {
                const msg = '⚠️ Không parse được từ hợp lệ nào từ các feedback pending.';
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: msg, ephemeral: true });
                } else {
                    await interaction.reply({ content: msg, ephemeral: true });
                }
                return;
            }

            const remainingCount = pendingWordFeedbacks.length - batchFeedbacks.length;

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle(`📋 Duyệt tổng — Đợt này: ${batchWords.length} từ (${batchFeedbacks.length}/${pendingWordFeedbacks.length} feedback)`)
                .setDescription(
                    batchWords.map(w => {
                        const info = wordMap.get(w);
                        const userNames = [...new Set(info.users.map(u => u.username))];
                        return `• **${w}** _(${userNames.join(', ')})_`;
                    }).join('\n').substring(0, 4000)
                )
                .setColor(0x5865F2)
                .setTimestamp();

            if (remainingCount > 0) {
                embed.addFields({
                    name: '📦 Duyệt lần lượt theo đợt (tối đa 25 từ/đợt)',
                    value: `Đợt này xử lý **${batchWords.length} từ** từ **${batchFeedbacks.length} feedback**.\nCòn lại **${remainingCount} feedback** đang chờ. Sau khi duyệt xong đợt này bot sẽ hiển thị nút để duyệt tiếp.`,
                    inline: false
                });
            }

            // Select menu (max 25)
            const selectOptions = batchWords.map(word => ({
                label: word,
                value: word,
                description: (wordMap.get(word)?.users?.map(u => u.username).join(', ') || '').substring(0, 50),
                default: true
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('bulk_word_select')
                .setPlaceholder('Chọn từ muốn duyệt (mặc định chọn hết)')
                .setMinValues(0)
                .setMaxValues(selectOptions.length)
                .addOptions(selectOptions);

            const approveBtn = new ButtonBuilder()
                .setCustomId('bulk_approve')
                .setLabel(`✅ Duyệt đợt này (${batchWords.length})`)
                .setStyle(ButtonStyle.Success);

            const components = [
                new ActionRowBuilder().addComponents(selectMenu),
                new ActionRowBuilder().addComponents(approveBtn)
            ];

            // Store bulk state on disk (persists across PM2 clusters and restarts)
            const bulkState = {
                allWords: [...batchWords],
                selectedWords: [...batchWords],
                wordMap,
                feedbackIds: batchFeedbacks.map(f => f.id)
            };
            this._saveBulkState(bulkState);

            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ embeds: [embed], components, ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], components, ephemeral: true });
            }
            logger.info(`Admin opened bulk review batch: ${batchWords.length} words from ${batchFeedbacks.length} feedbacks (${remainingCount} remaining)`);
        } catch (error) {
            logger.error(`Failed to open bulk review: ${error.message}`);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: `❌ Lỗi: ${error.message}`, ephemeral: true });
            } else {
                await interaction.reply({ content: `❌ Lỗi: ${error.message}`, ephemeral: true });
            }
        }
    }

    _saveBulkState(bulkState) {
        try {
            const filePath = path.join(__dirname, '..', 'data_bulk.json');
            if (!bulkState) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                this._pendingBulkApproval = null;
                return;
            }
            const serializable = {
                allWords: bulkState.allWords || [],
                selectedWords: bulkState.selectedWords || [],
                wordMap: bulkState.wordMap instanceof Map ? Object.fromEntries(bulkState.wordMap) : (bulkState.wordMap || {}),
                feedbackIds: bulkState.feedbackIds || []
            };
            fs.writeFileSync(filePath, JSON.stringify(serializable), 'utf-8');
            this._pendingBulkApproval = bulkState;
        } catch (e) {
            logger.error(`Error saving bulk state: ${e.message}`);
        }
    }

    _loadBulkState() {
        try {
            const filePath = path.join(__dirname, '..', 'data_bulk.json');
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(raw);
                return {
                    allWords: data.allWords || [],
                    selectedWords: data.selectedWords || [],
                    wordMap: new Map(Object.entries(data.wordMap || {})),
                    feedbackIds: data.feedbackIds || []
                };
            }
        } catch (e) {
            logger.error(`Error loading bulk state: ${e.message}`);
        }
        return this._pendingBulkApproval || null;
    }

    /**
     * Handle bulk word select menu change
     */
    async handleBulkWordSelect(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        try {
            const bulk = this._loadBulkState();
            const currentMenu = interaction.message?.components?.[0]?.components?.[0];
            const messageOptions = currentMenu?.options || [];
            const selectedWords = interaction.values || [];

            // Update selectedWords in bulk state on disk
            if (bulk) {
                bulk.selectedWords = selectedWords;
                this._saveBulkState(bulk);
            }

            // Build options: preserve existing options from Discord message, fallback to bulk.allWords
            let selectOptions = [];
            if (messageOptions.length > 0) {
                selectOptions = messageOptions.map(opt => ({
                    label: opt.label,
                    value: opt.value,
                    description: opt.description || '',
                    default: selectedWords.includes(opt.value)
                }));
            } else if (bulk && bulk.allWords?.length > 0) {
                const wordMap = bulk.wordMap || new Map();
                selectOptions = bulk.allWords.map(word => ({
                    label: word,
                    value: word,
                    description: (wordMap.get(word)?.users?.map(u => u.username).join(', ') || '').substring(0, 50),
                    default: selectedWords.includes(word)
                }));
            }

            if (selectOptions.length === 0) {
                await interaction.reply({ content: '⚠️ Phiên duyệt không còn tồn tại. Vui lòng mở lại "Duyệt tổng".', ephemeral: true }).catch(() => { });
                return;
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('bulk_word_select')
                .setPlaceholder('Chọn từ muốn duyệt')
                .setMinValues(0)
                .setMaxValues(selectOptions.length)
                .addOptions(selectOptions);

            const approveBtn = new ButtonBuilder()
                .setCustomId('bulk_approve')
                .setLabel(`✅ Duyệt đợt này (${selectedWords.length})`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(selectedWords.length === 0);

            await interaction.update({
                components: [
                    new ActionRowBuilder().addComponents(selectMenu),
                    new ActionRowBuilder().addComponents(approveBtn)
                ]
            });
        } catch (error) {
            logger.error(`Failed to handle bulk word select: ${error.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `❌ Lỗi khi chọn từ: ${error.message}`, ephemeral: true }).catch(() => { });
            }
        }
    }

    /**
     * Handle bulk approve button
     */
    async handleBulkApprove(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: '❌ Chỉ admin bot mới có thể thực hiện.', ephemeral: true });
            return;
        }

        if (this._isBulkApproving) {
            await interaction.reply({ content: '⏳ Đang xử lý duyệt từ, vui lòng đợi trong giây lát...', ephemeral: true }).catch(() => { });
            return;
        }

        const bulk = this._loadBulkState();
        if (!bulk || !bulk.selectedWords || bulk.selectedWords.length === 0) {
            await interaction.reply({ content: '⚠️ Không có từ nào được chọn hoặc phiên duyệt đã hoàn tất.', ephemeral: true }).catch(() => { });
            return;
        }

        this._isBulkApproving = true;

        try {
            // Immediately lock UI button so user cannot double-click
            await interaction.update({
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('bulk_approving_in_progress')
                            .setLabel('⏳ Đang xử lý duyệt từ...')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    )
                ]
            });

            // Add all selected words
            const wordsToAdd = bulk.selectedWords.join(', ');
            const result = gameLogic.addWord(wordsToAdd);

            const totalApproved = result.added?.length || 0;

            // Build result summary
            let resultDesc = '';
            if (totalApproved > 0) {
                resultDesc += `✅ **Đã thêm (${totalApproved}):** ${result.added.map(w => `**${w}**`).join(', ')}\n`;
            }
            if (result.existing?.length > 0) {
                resultDesc += `⚠️ **Đã có sẵn (${result.existing.length}):** ${result.existing.join(', ')}\n`;
            }
            if (result.invalid?.length > 0) {
                resultDesc += `❌ **Không hợp lệ (${result.invalid.length}):** ${result.invalid.join(', ')}\n`;
            }

            // Notify each user whose words were approved
            if (totalApproved > 0 && bulk.wordMap) {
                // Group approved words by user
                const userWordMap = new Map(); // userId -> { username, words: [], feedbackIds: Set }
                for (const addedWord of result.added) {
                    const info = bulk.wordMap.get(addedWord);
                    if (info) {
                        for (const user of info.users) {
                            if (!userWordMap.has(user.userId)) {
                                userWordMap.set(user.userId, { username: user.username, words: [], feedbackIds: new Set() });
                            }
                            const userData = userWordMap.get(user.userId);
                            userData.words.push(addedWord);
                            userData.feedbackIds.add(user.feedbackId);
                        }
                    }
                }

                // Send DM to each user
                for (const [uid, data] of userWordMap) {
                    try {
                        const targetUser = await this.client.users.fetch(uid);
                        // Use first feedbackId for reply thread
                        const replyFeedbackId = [...data.feedbackIds][0];
                        const userEmbed = new EmbedBuilder()
                            .setTitle('✅ Từ của bạn đã được thêm vào từ điển!')
                            .setDescription('Cảm ơn bạn đã đóng góp, từ đã được thêm và có hiệu lực ngay lập tức, chúc bạn chơi game vui vẻ <3')
                            .setColor(0x57F287)
                            .setFooter({ text: 'Bot Nối Từ 🐧' })
                            .setTimestamp();

                        const userReplyBtn = new ButtonBuilder()
                            .setCustomId(`userreply_${replyFeedbackId}`)
                            .setLabel('Trả lời')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('💬');

                        const userRow = new ActionRowBuilder().addComponents(userReplyBtn);
                        await targetUser.send({ embeds: [userEmbed], components: [userRow] });
                    } catch (dmErr) {
                        logger.warn(`Could not DM user ${uid}: ${dmErr.message}`);
                    }
                }
            }

            // Mark feedbacks in THIS batch as resolved + save reply history
            const feedbacks = gameLogic.getAllFeedbacks();
            for (const fbId of bulk.feedbackIds) {
                const fb = feedbacks.find(f => f.id === fbId);
                if (fb) {
                    fb.status = 'resolved';
                    if (!fb.replies) fb.replies = [];
                    fb.replies.push({
                        from: 'admin',
                        content: 'Cảm ơn bạn đã đóng góp, từ đã được thêm và có hiệu lực ngay lập tức, chúc bạn chơi game vui vẻ <3',
                        timestamp: new Date().toISOString()
                    });
                }
            }
            gameLogic.saveFeedbacks(feedbacks);

            // Clean up pending state on disk
            this._saveBulkState(null);

            // Check remaining pending feedbacks
            const remainingCount = feedbacks.filter(
                f => f.status === 'pending' && f.content.startsWith('[Từ còn thiếu]')
            ).length;

            if (remainingCount > 0) {
                resultDesc += `\n📦 **Còn lại ${remainingCount} feedback đang chờ.** Bấm nút bên dưới để duyệt tiếp đợt sau!`;
            } else {
                resultDesc += `\n🎉 **Đã duyệt hết tất cả feedback "Từ còn thiếu"!**`;
            }

            // Update embed with result and continuation button
            const updatedEmbed = new EmbedBuilder()
                .setTitle(`📋 Duyệt tổng — Hoàn tất đợt`)
                .setDescription(resultDesc || 'Không có từ nào được thêm.')
                .setColor(totalApproved > 0 ? 0x57F287 : 0xED4245)
                .setTimestamp();

            const actionButtons = [
                new ButtonBuilder()
                    .setCustomId('bulk_approve_done')
                    .setLabel(`✅ Đã duyệt ${totalApproved} từ`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true)
            ];

            if (remainingCount > 0) {
                actionButtons.push(
                    new ButtonBuilder()
                        .setCustomId('bulk_review')
                        .setLabel(`⏭️ Duyệt tiếp (${remainingCount} feedback còn lại)`)
                        .setStyle(ButtonStyle.Primary)
                );
            }

            await interaction.editReply({
                embeds: [updatedEmbed],
                components: [new ActionRowBuilder().addComponents(actionButtons)]
            });

            logger.info(`Admin bulk approved ${totalApproved} words from ${bulk.feedbackIds.length} feedbacks (${remainingCount} remaining)`);
        } catch (error) {
            logger.error(`Failed to bulk approve: ${error.message}`);
            try {
                await interaction.followUp({ content: `❌ Lỗi: ${error.message}`, ephemeral: true });
            } catch (e) { /* ignore */ }
        } finally {
            this._isBulkApproving = false;
        }
    }

    async onMessageCreate(message) {
        if (message.author.bot) return;

        const userMessage = message.content ? message.content.toLowerCase().trim() : '';
        if (!userMessage) return;

        const channelId = message.channel.id.toString();
        const userId = message.author.id;
        const isDM = this.isDirectMessage(message.channel);

        try {
            if (isDM) {
                const context = { isDM: true, userName: message.author.username };
                // Check if this is a first-time DM user (no existing game data)
                const users = db.read('users') || {};
                const existingUserData = users[userId];

                if (!existingUserData || !existingUserData.word) {
                    // First-time user: send welcome + start game
                    const response = gameLogic.checkUser(userMessage, userId, context);

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

                const response = gameLogic.checkUser(userMessage, userId, context);
                const embed = new EmbedBuilder()
                    .setDescription(response.message)
                    .setColor(response.type === 'success' ? 0x00FF00 : response.type === 'error' ? (response.streakReset || response.code === 'loss' ? 0xFF0000 : 0xFFFF00) : 0x0099FF);
                await message.reply({ embeds: [embed] });
                if (response.currentWord) {
                    const label = response.type === 'success' ? 'Từ mới' : 'Từ hiện tại';
                    await message.channel.send(`${label}: **${response.currentWord}**`);
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
                    const context = {
                        isDM: false,
                        guildName: message.guild?.name || 'Server',
                        channelName: message.channel.name || channelId,
                        userName: message.author.username
                    };
                    const response = gameLogic.checkChannel(userMessage, channelId, userId, context);

                    if (mode === 'pvp') {
                        await this.handlePvPResponse(message, response);
                    } else {
                        const embed = new EmbedBuilder()
                            .setDescription(response.message)
                            .setColor(response.type === 'success' ? 0x00FF00 : response.type === 'error' ? (response.streakReset || response.code === 'loss' ? 0xFF0000 : 0xFFFF00) : 0x0099FF);
                        await message.reply({ embeds: [embed] });
                        if (response.currentWord) {
                            const label = response.type === 'success' ? 'Từ mới' : 'Từ hiện tại';
                            await message.channel.send(`${label}: **${response.currentWord}**`);
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
                if (response.hintBonus) {
                    await message.reply({ content: response.hintBonus.trim() });
                }
            } else if (response.code === 'win') {
                await message.react('🏆');
                const embed = new EmbedBuilder()
                    .setDescription(response.message)
                    .setColor(0x00FF00);
                await message.reply({ embeds: [embed] });
                if (response.currentWord) {
                    await message.channel.send(`**Game mới bắt đầu!**\nTừ hiện tại: **${response.currentWord}**`);
                }
            } else {
                const reactionEmoji = response.code === 'invalid_format' ? '⚠️' : response.type === 'error' ? '❌' : 'ℹ️';
                await message.react(reactionEmoji).catch(() => { });

                const embed = new EmbedBuilder()
                    .setDescription(response.message)
                    .setColor(response.type === 'success' ? 0x00FF00 : response.type === 'error' ? (response.streakReset || response.code === 'loss' ? 0xFF0000 : 0xFFFF00) : 0x0099FF);

                await message.reply({ embeds: [embed] });
                if (response.currentWord) {
                    await message.channel.send(`Từ hiện tại: **${response.currentWord}**`);
                }
            }
        } catch (e) {
            logger.error(`Failed to handle PvP response: ${e.message}`);
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
