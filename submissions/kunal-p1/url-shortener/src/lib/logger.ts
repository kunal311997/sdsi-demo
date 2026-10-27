/** Logging. Structured JSON in production, pretty output in development. */

import pino, { type Logger } from 'pino';

import type { AppConfig } from '../config.js';

export type { Logger };

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const pretty =
    config.NODE_ENV !== 'production' && config.NODE_ENV !== 'test'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        }
      : undefined;

  return pino({
    level: config.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      // Never log credentials or full target URLs.
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'apiKey',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: pretty } : {}),
  });
}

/** Silent logger for tests. */
export const silentLogger: Logger = pino({ level: 'silent' });
