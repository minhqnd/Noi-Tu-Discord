const winston = require('winston');
const path = require('path');

// Game constants
const GAME_CONSTANTS = {
    MAX_WRONG_COUNT: 3,
    WORD_LENGTH: 2, // words must have exactly 2 syllables
    LOG_FILE_SIZE: 32 * 1024 * 1024, // 32MB
    MAX_LOG_FILES: 3,
    PENDING_GAME_TIMEOUT: 15_000, // 15 seconds
    BLOCK_MESSAGE_TIMEOUT: 3000, // 3 seconds
};

// Game modes
const GAME_MODES = {
    BOT: 'bot',
    PVP: 'pvp'
};

// Response codes
const RESPONSE_CODES = {
    OK: 'ok',
    MISMATCH: 'mismatch',
    REPEATED: 'repeated',
    NOT_IN_DICT: 'not_in_dict',
    INVALID_FORMAT: 'invalid_format',
    LOSS: 'loss'
};

// Response types
const RESPONSE_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    INFO: 'info'
};

// Discord permissions
const PERMISSIONS = {
    MANAGE_GUILD: 'ManageGuild',
    ADMINISTRATOR: 'Administrator',
    MODERATE_MEMBERS: 'ModerateMembers',
    MANAGE_MESSAGES: 'ManageMessages'
};

// File paths
const PATHS = {
    DATA_FILE: 'data.json',
    LOG_FILE: 'bot.log',
    WORD_PAIRS_FILE: 'src/assets/wordPairs.json'
};

// Logging setup
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let color;
        switch (level) {
            case 'error': color = '\x1b[31m'; break;
            case 'warn': color = '\x1b[33m'; break;
            case 'info': color = '\x1b[34m'; break;
            case 'debug': color = '\x1b[35m'; break;
            default: color = '\x1b[0m';
        }
        return `\x1b[30;1m${timestamp}\x1b[0m ${color}${level.toUpperCase().padEnd(8)}\x1b[0m \x1b[35m${meta.module || 'unknown'}\x1b[0m -> ${message}`;
    })
);

const logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: path.join(__dirname, '..', 'bot.log'),
            maxsize: 32 * 1024 * 1024, // 32MB
            maxFiles: 3,
            tailable: true
        })
    ]
});

function setupLogger(moduleName) {
    return logger.child({ module: moduleName });
}

module.exports = {
    GAME_CONSTANTS,
    GAME_MODES,
    RESPONSE_CODES,
    RESPONSE_TYPES,
    PERMISSIONS,
    PATHS,
    setupLogger
};