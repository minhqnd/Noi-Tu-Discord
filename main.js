require('dotenv').config();

const DiscordBot = require('./src/discordBot');
const db = require('./src/db');
const { setupLogger } = require('./src/utils');

const logger = setupLogger('main');

async function main() {
    let bot;
    try {
        bot = new DiscordBot();
        const token = process.env.DISCORD_BOT_TOKEN;

        if (!token) {
            logger.error('DISCORD_BOT_TOKEN not found in environment variables');
            process.exit(1);
        }

        const handleShutdown = (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            if (bot && bot.client) {
                try {
                    bot.client.destroy();
                } catch (e) {
                    logger.error(`Error destroying Discord client: ${e.message}`);
                }
            }
            db.close();
            process.exit(0);
        };

        process.on('SIGINT', () => handleShutdown('SIGINT'));
        process.on('SIGTERM', () => handleShutdown('SIGTERM'));

        await bot.start(token);
        logger.info('Bot started successfully');
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}

main();
