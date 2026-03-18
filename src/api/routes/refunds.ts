import { Router } from 'express';
import type { Request, Response } from 'express';
import { CreateRefundSchema } from '../middleware/validation';
import type { PaymentService } from '../../application/services/payment.service';
import { logger } from '../../infrastructure/observability/logger';

export function createRefundRouter(paymentService: PaymentService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = req.headers['x-request-id'] as string | undefined;

    const body = CreateRefundSchema.parse(req.body);

    logger.info({ requestId, paymentId: body.paymentId }, 'POST /refunds');

    const payment = await paymentService.createRefund({
      paymentId: body.paymentId,
      amount: body.amount,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });

    res.status(200).json({ data: payment });
  });

  return router;
}
