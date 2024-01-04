import winston from 'winston';
import  DailyRotateFile from 'winston-daily-rotate-file';
import Transport, { TransportStreamOptions } from 'winston-transport';
import * as Sentry from '@sentry/node';
import { Event as SentryEvent } from '@sentry/node';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

const isDev = process.env.NODE_ENV === 'dev';
const isTest = process.env.NODE_ENV === 'test';

let useSentry = false;

class SentryTransport extends Transport {
  constructor(opts?: TransportStreamOptions) {
    super(opts);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    let level = info.level;
    if (level === 'warn') level = 'warning'; // Sentry uses 'warning' instead of 'warn'

    if (level === 'error' || level === 'warning') {
      const event: SentryEvent = {
        level: level,
        message: info.message,
        extra: info,
      };
      Sentry.captureEvent(event);
    }

    callback();
  }

  eventNames(): Array<string | symbol> {
    return undefined;
  }

  getMaxListeners(): number {
    return 0;
  }

  listenerCount(_: string | symbol, __?: any): number {
    return 0;
  }

  listeners(_: string | symbol): any[] {
    return [];
  }

  off(_: string | symbol, __: (...args: any[]) => void): this {
    return undefined;
  }

  rawListeners(_: string | symbol): any[] {
    return [];
  }

  removeAllListeners(_?: string | symbol): this {
    return undefined;
  }

  setMaxListeners(_: number): this {
    return undefined;
  }
}

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.simple(),
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}] ${message}`;
  }),
);
let logger;


const allTransport: DailyRotateFile = new DailyRotateFile({
  filename: `debug-%DATE%.log`,
  dirname: `${projectRoot}/logs/`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '30m',
  maxFiles: '30d',
  level: 'debug'
});

const errorTransport: DailyRotateFile = new DailyRotateFile({
  filename: `error-%DATE%.log`,
  dirname: `${projectRoot}/logs/`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '30m',
  maxFiles: '30d',
  level: 'error',
});


if (isDev) {
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    format: consoleFormat,
    transports: [new winston.transports.Console({ format: consoleFormat }), allTransport, errorTransport],
  });
} else if (isTest) {
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'error',
    format: consoleFormat,
    transports: [new winston.transports.Console({ format: consoleFormat }), allTransport, errorTransport],
  });
} else {
  // isProd
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.simple(),
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      //new winston.transports.File({ filename: 'error.log', level: 'error' }),
      errorTransport
    ],
  });
}

export function addSentryToLogger(sentryDSN: string, appVersion: string, configType: string) {
  useSentry = true;
  Sentry.init({
    dsn: sentryDSN,
    release: appVersion,

    tracesSampleRate: 1.0,

    beforeSend: function (event, hint) {
      delete event.contexts.culture;
      delete event.server_name;

      const substituteValue = '/pp-agent-v2-node';

      event.exception?.values?.forEach(e => {
        e.stacktrace.frames.forEach(f => {
          f.filename = f.filename.replace(projectRoot, substituteValue);
        });
      });

      const partToSubstitute = new RegExp(path.normalize(projectRoot), 'g');

      event.message = event.message?.replace(partToSubstitute, substituteValue);
      if (event.extra) {
        event.extra.message = ((event.extra.message as string) || '').replace(partToSubstitute, substituteValue);
      }

      if (hint.syntheticException) {
        hint.syntheticException.stack = hint.syntheticException.stack?.replace(partToSubstitute, substituteValue);
      }

      return event;
    },
  });
  Sentry.configureScope(scope => {
    scope.setTag('env', isDev ? 'dev' : isTest ? 'test' : 'prod');
    scope.setTag('configType', configType);
  });
  logger.add(
    new SentryTransport({
      handleExceptions: false,
      handleRejections: true,
    }),
  );
}

export function updateSentryScope(
  networkName: string,
  networkRpc: string,
  agentAddress: string,
  keeperWorkerAddress: string,
  dataSource: string,
  subgraphUrl: string,
) {
  if (useSentry) {
    Sentry.configureScope(scope => {
      scope.setTag('networkName', networkName);
      scope.setTag('networkRpc', networkRpc);
      scope.setTag('agentAddress', agentAddress);
      scope.setTag('keeperWorkerAddress', keeperWorkerAddress);
      scope.setTag('dataSource', dataSource);
      scope.setTag('subgraphUrl', subgraphUrl);
    });
  }
}

export default logger;
