const winston = require('winston');
const path = require('path');

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

module.exports = { setupLogger };