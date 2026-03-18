import { v4 as uuidv4 } from 'uuid';
import type { PaymentRepository, TransactionRepository } from '../../domain/interfaces/payment-repository';
import type { Payment, CreatePaymentInput, CreateRefundInput } from '../../domain/types';
import type { RoutingService } from './routing.service';
import type { IdempotencyService } from '../../infrastructure/redis/idempotency';
import type { EventPublisher } from '../../infrastructure/events/publisher';
import { circuitBreaker } from '../../infrastructure/circuit-breaker';
import { metrics } from '../../infrastructure/observability/metrics';
import { logger } from '../../infrastructure/observability/logger';
import { NotFoundError, RefundError, ProviderError } from '../../domain/errors';
import { config } from '../../config';

export class PaymentService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly routingService: RoutingService,
    private readonly idempotency: IdempotencyService,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const cached = await this.idempotency.getStoredResponse(input.idempotencyKey);
    if (cached) {
      logger.info({ idempotencyKey: input.idempotencyKey }, 'Returning cached idempotency response');
      return cached.responseBody as Payment;
    }

    await this.idempotency.acquireLockOrThrow(input.idempotencyKey);

    let payment: Payment;
    try {
      payment = await this.paymentRepo.create({
        ...input,
        id: uuidv4(),
      });

      await this.eventPublisher.publish({
        eventType: 'payment.created',
        paymentId: payment.id,
        merchantId: payment.merchantId,
        amount: payment.amount,
        currency: payment.currency,
        providerId: null,
        timestamp: new Date().toISOString(),
        metadata: payment.metadata,
      });

      payment = await this.chargeWithRetry(payment);

      await this.idempotency.storeResponse(input.idempotencyKey, payment.id, payment);
      await this.idempotency.cachePayment(payment.id, payment);
    } finally {
      await this.idempotency.releaseLock(input.idempotencyKey);
    }

    return payment;
  }

  async getPayment(id: string): Promise<Payment> {
    const cached = await this.idempotency.getCachedPayment(id);
    if (cached) {
      return cached as Payment;
    }

    const payment = await this.paymentRepo.findById(id);
    if (!payment) {
      throw new NotFoundError('Payment', id);
    }

    await this.idempotency.cachePayment(id, payment);
    return payment;
  }

  async createRefund(input: CreateRefundInput): Promise<Payment> {
    const payment = await this.paymentRepo.findById(input.paymentId);
    if (!payment) {
      throw new NotFoundError('Payment', input.paymentId);
    }

    if (payment.status !== 'succeeded') {
      throw new RefundError(`Cannot refund payment in status '${payment.status}'`);
    }

    if (input.amount > payment.amount) {
      throw new RefundError(`Refund amount ${input.amount} exceeds payment amount ${payment.amount}`);
    }

    if (!payment.providerId || !payment.providerTransactionId) {
      throw new RefundError('Payment has no associated provider transaction');
    }

    const provider = this.routingService.getProviderById(payment.providerId);
    if (!provider) {
      throw new RefundError(`Provider '${payment.providerId}' not found`);
    }

    const start = Date.now();
    const result = await circuitBreaker.execute(payment.providerId, () =>
      provider.refund({
        paymentId: payment.id,
        providerTransactionId: payment.providerTransactionId!,
        amount: input.amount,
        currency: payment.currency,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      }),
    );
    const latencyMs = Date.now() - start;

    metrics.recordProviderCall(payment.providerId, result.success, latencyMs);

    await this.transactionRepo.create({
      id: uuidv4(),
      paymentId: payment.id,
      providerId: payment.providerId,
      providerTransactionId: result.providerTransactionId,
      type: 'refund',
      amount: input.amount,
      currency: payment.currency,
      status: result.success ? 'succeeded' : 'failed',
      latencyMs,
      errorCode: result.errorCode ?? null,
    });

    if (!result.success) {
      throw new ProviderError(payment.providerId, result.errorMessage ?? 'Refund failed', result.errorCode);
    }

    const newStatus = input.amount === payment.amount ? 'refunded' : 'partially_refunded';
    const updated = await this.paymentRepo.updateStatus(payment.id, newStatus);
    await this.idempotency.invalidateCachedPayment(payment.id);

    return updated;
  }

  private async chargeWithRetry(payment: Payment): Promise<Payment> {
    const ctx = {
      currency: payment.currency,
      region: payment.region,
      amount: payment.amount,
      merchantId: payment.merchantId,
    };

    const triedProviders: typeof payment.providerId[] = [];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.routing.maxRetries; attempt++) {
      const provider = await this.routingService.selectProviderWithFallback(
        ctx,
        triedProviders.filter(Boolean) as NonNullable<typeof payment.providerId>[],
      );
      triedProviders.push(provider.id);

      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, config.routing.retryDelayMs * attempt));
      }

      const start = Date.now();
      let result;
      try {
        result = await circuitBreaker.execute(provider.id, () =>
          provider.charge({
            paymentId: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            customerId: payment.customerId,
            metadata: payment.metadata,
          }),
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { attempt, provider: provider.id, err: lastError.message },
          'Provider charge attempt failed (circuit)',
        );
        continue;
      }

      const latencyMs = Date.now() - start;
      metrics.recordProviderCall(provider.id, result.success, latencyMs);

      await this.transactionRepo.create({
        id: uuidv4(),
        paymentId: payment.id,
        providerId: provider.id,
        providerTransactionId: result.providerTransactionId,
        type: 'charge',
        amount: payment.amount,
        currency: payment.currency,
        status: result.success ? 'succeeded' : 'failed',
        latencyMs,
        errorCode: result.errorCode ?? null,
      });

      if (result.success) {
        const updated = await this.paymentRepo.updateStatus(payment.id, 'succeeded', {
          providerId: provider.id,
          providerTransactionId: result.providerTransactionId,
        });

        await this.eventPublisher.publish({
          eventType: 'payment.succeeded',
          paymentId: updated.id,
          merchantId: updated.merchantId,
          amount: updated.amount,
          currency: updated.currency,
          providerId: updated.providerId,
          timestamp: new Date().toISOString(),
        });

        logger.info(
          { paymentId: payment.id, provider: provider.id, latencyMs, attempt },
          'Payment charge succeeded',
        );

        return updated;
      }

      circuitBreaker.recordFailure(provider.id);
      lastError = new ProviderError(provider.id, result.errorMessage ?? 'Charge failed', result.errorCode);

      logger.warn(
        { paymentId: payment.id, provider: provider.id, attempt, errorCode: result.errorCode },
        'Provider charge failed, retrying with fallback',
      );
    }

    const failed = await this.paymentRepo.updateStatus(payment.id, 'failed');

    await this.eventPublisher.publish({
      eventType: 'payment.failed',
      paymentId: failed.id,
      merchantId: failed.merchantId,
      amount: failed.amount,
      currency: failed.currency,
      providerId: null,
      timestamp: new Date().toISOString(),
    });

    throw lastError ?? new Error('All payment attempts failed');
  }
}
