import type { Redis } from 'ioredis';
import { config } from '../../config';
import { IdempotencyConflictError } from '../../domain/errors';
import { logger } from '../observability/logger';

const LOCK_PREFIX = 'idempotency:lock:';
const RECORD_PREFIX = 'idempotency:record:';

export class IdempotencyService {
  constructor(private readonly redis: Redis) {}

  async acquireLock(key: string): Promise<boolean> {
    const lockKey = `${LOCK_PREFIX}${key}`;
    const result = await this.redis.set(
      lockKey,
      '1',
      'EX',
      config.idempotency.lockTtlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(`${LOCK_PREFIX}${key}`);
  }

  async acquireLockOrThrow(key: string): Promise<void> {
    const acquired = await this.acquireLock(key);
    if (!acquired) {
      throw new IdempotencyConflictError(key);
    }
  }

  async storeResponse(key: string, paymentId: string, responseBody: unknown): Promise<void> {
    const recordKey = `${RECORD_PREFIX}${key}`;
    await this.redis.set(
      recordKey,
      JSON.stringify({ paymentId, responseBody }),
      'EX',
      config.idempotency.recordTtlSeconds,
    );
  }

  async getStoredResponse(key: string): Promise<{ paymentId: string; responseBody: unknown } | null> {
    const recordKey = `${RECORD_PREFIX}${key}`;
    const raw = await this.redis.get(recordKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { paymentId: string; responseBody: unknown };
    } catch {
      logger.warn({ key }, 'Failed to parse idempotency record; treating as cache miss');
      return null;
    }
  }

  async invalidateCachedPayment(paymentId: string): Promise<void> {
    await this.redis.del(`payment:${paymentId}`);
  }

  async getCachedPayment(paymentId: string): Promise<unknown | null> {
    const raw = await this.redis.get(`payment:${paymentId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      logger.warn({ paymentId }, 'Failed to parse cached payment; treating as cache miss');
      return null;
    }
  }

  async cachePayment(paymentId: string, payment: unknown, ttlSeconds = 60): Promise<void> {
    await this.redis.set(`payment:${paymentId}`, JSON.stringify(payment), 'EX', ttlSeconds);
  }
}
