import type { Redis } from 'ioredis';
import type { PaymentEvent } from '../../domain/types';
import { config } from '../../config';
import { logger } from '../observability/logger';

export class EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: PaymentEvent): Promise<void> {
    try {
      await this.redis.xadd(
        config.events.streamKey,
        'MAXLEN',
        '~',
        config.events.maxStreamLength,
        '*',
        'type', event.eventType,
        'paymentId', event.paymentId,
        'merchantId', event.merchantId,
        'amount', String(event.amount),
        'currency', event.currency,
        'providerId', event.providerId ?? '',
        'timestamp', event.timestamp,
        'metadata', JSON.stringify(event.metadata ?? {}),
      );
    } catch (err) {
      logger.error({ err, event }, 'Failed to publish event to Redis Streams');
    }
  }
}
