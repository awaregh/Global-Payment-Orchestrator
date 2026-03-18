import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreatePaymentSchema, GetPaymentParamsSchema } from '../middleware/validation';
import type { PaymentService } from '../../application/services/payment.service';
import { logger } from '../../infrastructure/observability/logger';
import { metrics } from '../../infrastructure/observability/metrics';

export function createPaymentRouter(paymentService: PaymentService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] as string | undefined;

    const body = CreatePaymentSchema.parse(req.body);

    logger.info({ requestId, idempotencyKey: body.idempotencyKey, merchantId: body.merchantId }, 'POST /payments');

    const payment = await paymentService.createPayment(body);

    const latency = Date.now() - start;
    metrics.recordRequest(latency);

    res.status(201).json({ data: payment });
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const { id } = GetPaymentParamsSchema.parse(req.params);

    const payment = await paymentService.getPayment(id);

    res.status(200).json({ data: payment });
  });

  return router;
}
