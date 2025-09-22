require('dotenv').config();

const DiscordBot = require('./src/discordBot');
const { setupLogger } = require('./src/utils');

const logger = setupLogger('main');

async function main() {
    try {
        const bot = new DiscordBot();
        const token = process.env.DISCORD_BOT_TOKEN;

        if (!token) {
            logger.error('DISCORD_BOT_TOKEN not found in environment variables');
            process.exit(1);
        }

        await bot.start(token);
        logger.info('Bot started successfully');
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}

main();
