import pino from 'pino';
import { config } from '../../config';

export const logger = pino({
  level: config.log.level,
  ...(config.log.pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: 'global-payment-orchestrator',
    env: config.env,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
