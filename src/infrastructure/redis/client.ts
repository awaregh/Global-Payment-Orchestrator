import Redis from 'ioredis';
import { config } from '../../config';
import { logger } from '../observability/logger';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  keyPrefix: config.redis.keyPrefix,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 200, 2000);
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

export async function testRedisConnection(): Promise<void> {
  await redis.ping();
  logger.info('Redis connection verified');
}
