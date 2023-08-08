import winston from 'winston';

const isDev = process.env.NODE_ENV === 'dev';
const isTest = process.env.NODE_ENV === 'test';

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.simple(),
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}] ${message}`;
  }),
);
let logger;

if (isDev) {
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    format: consoleFormat,
    transports: [new winston.transports.Console({ format: consoleFormat })],
  });
} else if (isTest) {
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'error',
    format: consoleFormat,
    transports: [new winston.transports.Console({ format: consoleFormat })],
  });
} else {
  // isProd
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.simple(),
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
    ],
  });
}

export default logger;
