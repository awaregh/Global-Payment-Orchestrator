import express from 'express';
import 'express-async-errors';
import { createPaymentRouter } from './routes/payments';
import { createRefundRouter } from './routes/refunds';
import { errorHandler } from './middleware/error-handler';
import type { PaymentService } from '../application/services/payment.service';
import { metrics } from '../infrastructure/observability/metrics';
import { logger } from '../infrastructure/observability/logger';

export function createApp(paymentService: PaymentService): express.Application {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.use((req, _res, next) => {
    req.headers['x-request-id'] =
      (req.headers['x-request-id'] as string) ??
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/metrics', (_req, res) => {
    res.status(200).json(metrics.getSystemStats());
  });

  app.use('/payments', createPaymentRouter(paymentService));
  app.use('/refunds', createRefundRouter(paymentService));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);

  logger.info('Express app initialized');
  return app;
}
