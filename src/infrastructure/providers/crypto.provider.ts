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

export class CryptoProvider implements PaymentProvider {
  readonly id = 'crypto' as const;
  readonly supportedCurrencies = ['BTC', 'ETH', 'USD'] as const;
  readonly supportedRegions = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-southeast', 'ap-northeast'] as const;

  private readonly failRate: number;

  constructor(failRate = 0.08) {
    this.failRate = failRate;
  }

  async charge(request: ChargeRequest): Promise<ProviderResult> {
    await simulateLatency(200, 800);

    if (shouldFail(this.failRate)) {
      return {
        success: false,
        providerTransactionId: `0x_fail_${uuidv4()}`,
        rawResponse: { error: 'insufficient_confirmations', confirmations: 0 },
        errorCode: 'insufficient_confirmations',
        errorMessage: 'Transaction failed: insufficient blockchain confirmations.',
      };
    }

    const txHash = `0x${Buffer.from(uuidv4().replace(/-/g, '')).toString('hex').slice(0, 64)}`;
    return {
      success: true,
      providerTransactionId: txHash,
      rawResponse: {
        txHash,
        amount: request.amount,
        currency: request.currency,
        confirmations: 6,
        blockHeight: Math.floor(Math.random() * 1_000_000 + 800_000),
        status: 'confirmed',
      },
    };
  }

  async refund(request: RefundRequest): Promise<ProviderResult> {
    await simulateLatency(300, 1000);

    if (shouldFail(this.failRate)) {
      return {
        success: false,
        providerTransactionId: `0x_refund_fail_${uuidv4()}`,
        rawResponse: { error: 'network_congestion' },
        errorCode: 'network_congestion',
        errorMessage: 'Refund failed due to network congestion.',
      };
    }

    const refundTxHash = `0x${Buffer.from(uuidv4().replace(/-/g, '')).toString('hex').slice(0, 64)}`;
    return {
      success: true,
      providerTransactionId: refundTxHash,
      rawResponse: {
        txHash: refundTxHash,
        originalTx: request.providerTransactionId,
        amount: request.amount,
        currency: request.currency,
        status: 'confirmed',
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    await simulateLatency(50, 150);
    return Math.random() > 0.1;
  }
}
