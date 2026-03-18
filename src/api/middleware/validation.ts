import { z } from 'zod';

export const CurrencySchema = z.enum(['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH']);
export const RegionSchema = z.enum(['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-southeast', 'ap-northeast']);

export const CreatePaymentSchema = z.object({
  idempotencyKey: z.string().min(1).max(255),
  merchantId: z.string().min(1).max(255),
  customerId: z.string().min(1).max(255),
  amount: z.number().int().positive().max(99_999_999),
  currency: CurrencySchema,
  region: RegionSchema,
  metadata: z.record(z.string(), z.string()).optional().default({}),
});

export const CreateRefundSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export const GetPaymentParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreatePaymentBody = z.infer<typeof CreatePaymentSchema>;
export type CreateRefundBody = z.infer<typeof CreateRefundSchema>;
