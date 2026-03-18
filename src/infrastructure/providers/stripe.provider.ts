import { v4 as uuidv4 } from 'uuid';
import type { PaymentProvider } from '../../domain/interfaces/payment-provider';
import type { ChargeRequest, RefundRequest, ProviderResult } from '../../domain/types';

function simulateLatency(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFail(failRate: number): boolean {
  return Math.random() < failRate;
}

export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly supportedCurrencies = ['USD', 'EUR', 'GBP', 'JPY'] as const;
  readonly supportedRegions = ['us-east', 'us-west', 'eu-west', 'eu-central'] as const;

  private readonly failRate: number;

  constructor(failRate = 0.03) {
    this.failRate = failRate;
  }

  async charge(request: ChargeRequest): Promise<ProviderResult> {
    await simulateLatency(50, 150);

    if (shouldFail(this.failRate)) {
      return {
        success: false,
        providerTransactionId: `ch_fail_${uuidv4()}`,
        rawResponse: { error: 'card_declined', decline_code: 'insufficient_funds' },
        errorCode: 'card_declined',
        errorMessage: 'Your card has insufficient funds.',
      };
    }

    const txId = `ch_${uuidv4().replace(/-/g, '')}`;
    return {
      success: true,
      providerTransactionId: txId,
      rawResponse: {
        id: txId,
        amount: request.amount,
        currency: request.currency.toLowerCase(),
        status: 'succeeded',
        payment_intent: `pi_${uuidv4().replace(/-/g, '')}`,
      },
    };
  }

  async refund(request: RefundRequest): Promise<ProviderResult> {
    await simulateLatency(80, 200);

    if (shouldFail(this.failRate)) {
      return {
        success: false,
        providerTransactionId: `re_fail_${uuidv4()}`,
        rawResponse: { error: 'charge_already_refunded' },
        errorCode: 'charge_already_refunded',
        errorMessage: 'The charge has already been refunded.',
      };
    }

    const refundId = `re_${uuidv4().replace(/-/g, '')}`;
    return {
      success: true,
      providerTransactionId: refundId,
      rawResponse: {
        id: refundId,
        amount: request.amount,
        charge: request.providerTransactionId,
        status: 'succeeded',
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    await simulateLatency(10, 30);
    return true;
  }
}
