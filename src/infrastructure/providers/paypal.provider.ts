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

export class PayPalProvider implements PaymentProvider {
  readonly id = 'paypal' as const;
  readonly supportedCurrencies = ['USD', 'EUR', 'GBP'] as const;
  readonly supportedRegions = ['us-east', 'us-west', 'eu-west'] as const;

  private readonly failRate: number;

  constructor(failRate = 0.05) {
    this.failRate = failRate;
  }

  async charge(request: ChargeRequest): Promise<ProviderResult> {
    await simulateLatency(100, 300);

    if (shouldFail(this.failRate)) {
      return {
        success: false,
        providerTransactionId: `PAYPAL_FAIL_${uuidv4()}`,
        rawResponse: { name: 'INSTRUMENT_DECLINED', details: [{ issue: 'INSTRUMENT_DECLINED' }] },
        errorCode: 'INSTRUMENT_DECLINED',
        errorMessage: 'The payment was declined by PayPal.',
      };
    }

    const orderId = `PAY-${uuidv4().toUpperCase()}`;
    return {
      success: true,
      providerTransactionId: orderId,
      rawResponse: {
        id: orderId,
        intent: 'CAPTURE',
        status: 'COMPLETED',
        purchase_units: [{ amount: { currency_code: request.currency, value: (request.amount / 100).toFixed(2) } }],
      },
    };
  }

  async refund(request: RefundRequest): Promise<ProviderResult> {
    await simulateLatency(150, 400);

    if (shouldFail(this.failRate)) {
      return {
        success: false,
        providerTransactionId: `PAYPAL_REFUND_FAIL_${uuidv4()}`,
        rawResponse: { name: 'REFUND_FAILED_INSUFFICIENT_FUNDS' },
        errorCode: 'REFUND_FAILED_INSUFFICIENT_FUNDS',
        errorMessage: 'The refund could not be processed.',
      };
    }

    const refundId = `REFUND-${uuidv4().toUpperCase()}`;
    return {
      success: true,
      providerTransactionId: refundId,
      rawResponse: {
        id: refundId,
        status: 'COMPLETED',
        amount: { currency_code: request.currency, value: (request.amount / 100).toFixed(2) },
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    await simulateLatency(20, 60);
    return true;
  }
}
