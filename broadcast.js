// Script chạy 1 lần để gửi thông báo bot hoạt động lại
// Usage: node broadcast.js

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const ANNOUNCEMENT_EMBED = new EmbedBuilder()
    .setTitle('🎉 Bot Nối Từ đã hoạt động trở lại!')
    .setDescription(
        'Xin chào! Bot đã được cập nhật và hoạt động trở lại sau thời gian bảo trì. Cảm ơn mọi người đã kiên nhẫn chờ đợi! Có lỗi gì hãy nhắn qua `/feedback` nha 💚'
    )
    .addFields(
        {
            name: '🎮 Để bắt đầu chơi',
            value: [
                '`/noitu_add` - Thêm kênh chơi nối từ (chỉ admin)',
                '`/noitu_mode` - Chọn chế độ chơi (chơi với bot hoặc chơi với nhau)',
                '`/newgame` - Bắt đầu ván mới',
                'Hoặc nhắn trực tiếp cho bot để chơi 1v1!'
            ].join('\n')
        },
        {
            name: '📖 Lệnh hữu ích',
            value: [
                '`/tratu [từ]` - Tra cứu từ điển tiếng Việt',
                '`/stats` - Xem thống kê',
                '`/help` - Xem hướng dẫn đầy đủ'
            ].join('\n')
        },
        {
            name: '✨ Có gì mới?',
            value: [
                '• Cập nhật từ điển mới với **357,000+ từ vựng**',
                '• Tra từ hiển thị thêm bản dịch và từ liên quan',
                '• Sửa lỗi và cải thiện hiệu năng'
            ].join('\n')
        }
    )
    .setColor(0x57F287)
    .setFooter({ text: 'Bot Nối Từ 🐧 | minhqnd' })
    .setTimestamp();

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Bot is in ${client.guilds.cache.size} servers\n`);
    // ── Chế độ gửi ──────────────────────────────────────────────
    // Test: chỉ gửi cho 1 server cụ thể
    const TARGET_GUILD_IDS = ['964898208696401930'];
    // Gửi tất cả: comment dòng trên, bỏ comment dòng dưới
    // const TARGET_GUILD_IDS = null;

    const guilds = TARGET_GUILD_IDS
        ? client.guilds.cache.filter(g => TARGET_GUILD_IDS.includes(g.id))
        : client.guilds.cache;

    console.log(`Sẽ gửi đến ${guilds.size}/${client.guilds.cache.size} servers\n`);

    let sent = 0;
    let failed = 0;

    for (const [guildId, guild] of guilds) {
        try {
            // Ưu tiên: system channel > kênh text đầu tiên bot có quyền gửi
            let targetChannel = guild.systemChannel;

            if (!targetChannel || !targetChannel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)) {
                // Tìm kênh text đầu tiên bot có quyền gửi
                targetChannel = guild.channels.cache.find(ch =>
                    ch.isTextBased() &&
                    !ch.isVoiceBased() &&
                    ch.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)
                );
            }

            if (targetChannel) {
                await targetChannel.send({
                    content: '@everyone',
                    embeds: [ANNOUNCEMENT_EMBED]
                });
                console.log(`✅ [${guild.name}] -> #${targetChannel.name}`);
                sent++;
            } else {
                console.log(`⚠️  [${guild.name}] -> Không tìm thấy kênh phù hợp`);
                failed++;
            }
        } catch (err) {
            console.log(`❌ [${guild.name}] -> Lỗi: ${err.message}`);
            failed++;
        }
    }

    console.log(`\n--- Kết quả ---`);
    console.log(`Đã gửi: ${sent}/${client.guilds.cache.size}`);
    console.log(`Thất bại: ${failed}`);

    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN);
