import type { Redis } from 'ioredis';
import { config } from '../../../config';
import { logger } from '../../observability/logger';

interface StreamMessage {
  type: string;
  paymentId: string;
  merchantId: string;
  amount: string;
  currency: string;
  providerId: string;
  timestamp: string;
  metadata: string;
}

function parseMessage(fields: string[]): StreamMessage {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const val = fields[i + 1];
    if (key !== undefined && val !== undefined) {
      obj[key] = val;
    }
  }
  return obj as unknown as StreamMessage;
}

export class AnalyticsConsumer {
  private running = false;
  private readonly consumerName: string;

  constructor(
    private readonly redis: Redis,
    consumerName = 'analytics-1',
  ) {
    this.consumerName = consumerName;
  }

  async start(): Promise<void> {
    await this.ensureConsumerGroup();
    this.running = true;
    void this.consume();
    logger.info({ consumer: this.consumerName }, 'Analytics consumer started');
  }

  stop(): void {
    this.running = false;
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE',
        config.events.streamKey,
        config.events.consumerGroup,
        '$',
        'MKSTREAM',
      );
    } catch (err) {
      if (err instanceof Error && !err.message.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  private async consume(): Promise<void> {
    while (this.running) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP',
          config.events.consumerGroup,
          this.consumerName,
          'COUNT',
          10,
          'BLOCK',
          1000,
          'STREAMS',
          config.events.streamKey,
          '>',
        );

        if (!results) continue;

        for (const [, messages] of results as [string, [string, string[]][]][]) {
          for (const [id, fields] of messages) {
            const msg = parseMessage(fields);
            this.processEvent(msg);

            await this.redis.xack(
              config.events.streamKey,
              config.events.consumerGroup,
              id,
            );
          }
        }
      } catch (err) {
        if (this.running) {
          logger.error({ err }, 'Analytics consumer error');
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  private processEvent(msg: StreamMessage): void {
    const providerId = msg.providerId;

    if (msg.type === 'payment.succeeded' && providerId) {
      logger.info(
        { paymentId: msg.paymentId, merchantId: msg.merchantId, provider: providerId },
        'Analytics: payment succeeded',
      );
    } else if (msg.type === 'payment.failed') {
      logger.info(
        { paymentId: msg.paymentId, type: msg.type },
        'Analytics: payment failed',
      );
    }
  }
}
