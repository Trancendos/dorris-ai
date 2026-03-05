/**
 * Dorris AI — Structured Logger
 * Pino-based structured logging with financial context
 */

import pino from 'pino';

export const logger = pino({
  name: 'dorris-ai',
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  base: {
    service: 'dorris-ai',
    version: process.env.npm_package_version || '1.0.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

export default logger;