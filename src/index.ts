import { config } from './config';
import { createApp } from './api/server';
import { pool, testConnection } from './infrastructure/db/postgres';
import { redis, testRedisConnection } from './infrastructure/redis/client';
import { PostgresPaymentRepository, PostgresTransactionRepository } from './infrastructure/db/repositories/payment.repository';
import { IdempotencyService } from './infrastructure/redis/idempotency';
import { EventPublisher } from './infrastructure/events/publisher';
import { AnalyticsConsumer } from './infrastructure/events/consumers/analytics.consumer';
import { StripeProvider } from './infrastructure/providers/stripe.provider';
import { PayPalProvider } from './infrastructure/providers/paypal.provider';
import { CryptoProvider } from './infrastructure/providers/crypto.provider';
import { circuitBreaker } from './infrastructure/circuit-breaker';
import { RoutingService } from './application/services/routing.service';
import { PaymentService } from './application/services/payment.service';
import { logger } from './infrastructure/observability/logger';
import type { ProviderId } from './domain/types';
import type { PaymentProvider } from './domain/interfaces/payment-provider';

async function bootstrap(): Promise<void> {
  logger.info('Starting Global Payment Orchestrator...');

  await testConnection();
  await redis.connect();
  await testRedisConnection();

  const paymentRepo = new PostgresPaymentRepository(pool);
  const transactionRepo = new PostgresTransactionRepository(pool);
  const idempotency = new IdempotencyService(redis);
  const eventPublisher = new EventPublisher(redis);

  const providers = new Map<ProviderId, PaymentProvider>([
    ['stripe', new StripeProvider()],
    ['paypal', new PayPalProvider()],
    ['crypto', new CryptoProvider()],
  ]);

  const routingService = new RoutingService(providers, circuitBreaker);
  const paymentService = new PaymentService(
    paymentRepo,
    transactionRepo,
    routingService,
    idempotency,
    eventPublisher,
  );

  const analyticsConsumer = new AnalyticsConsumer(redis);
  await analyticsConsumer.start();

  const app = createApp(paymentService);
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    analyticsConsumer.stop();
    server.close(async () => {
      await pool.end();
      await redis.quit();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
