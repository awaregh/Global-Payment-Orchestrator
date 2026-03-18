import { RoutingService } from './routing.service';
import { CircuitBreaker } from '../../infrastructure/circuit-breaker';
import { NoAvailableProviderError } from '../../domain/errors';
import type { PaymentProvider } from '../../domain/interfaces/payment-provider';
import type { ChargeRequest, RefundRequest, ProviderResult } from '../../domain/types';

const mockStripe: PaymentProvider = {
  id: 'stripe',
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'JPY'],
  supportedRegions: ['us-east', 'us-west', 'eu-west', 'eu-central'],
  charge: async (_r: ChargeRequest): Promise<ProviderResult> => ({
    success: true,
    providerTransactionId: 'ch_test',
    rawResponse: {},
  }),
  refund: async (_r: RefundRequest): Promise<ProviderResult> => ({
    success: true,
    providerTransactionId: 're_test',
    rawResponse: {},
  }),
  healthCheck: async () => true,
};

const mockPayPal: PaymentProvider = {
  id: 'paypal',
  supportedCurrencies: ['USD', 'EUR', 'GBP'],
  supportedRegions: ['us-east', 'us-west', 'eu-west'],
  charge: async (_r: ChargeRequest): Promise<ProviderResult> => ({
    success: true,
    providerTransactionId: 'pp_test',
    rawResponse: {},
  }),
  refund: async (_r: RefundRequest): Promise<ProviderResult> => ({
    success: true,
    providerTransactionId: 'pp_re_test',
    rawResponse: {},
  }),
  healthCheck: async () => true,
};

const mockCrypto: PaymentProvider = {
  id: 'crypto',
  supportedCurrencies: ['BTC', 'ETH', 'USD'],
  supportedRegions: ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-southeast', 'ap-northeast'],
  charge: async (_r: ChargeRequest): Promise<ProviderResult> => ({
    success: true,
    providerTransactionId: '0xtest',
    rawResponse: {},
  }),
  refund: async (_r: RefundRequest): Promise<ProviderResult> => ({
    success: true,
    providerTransactionId: '0xre_test',
    rawResponse: {},
  }),
  healthCheck: async () => true,
};

function makeRoutingService(overrides?: Partial<ConstructorParameters<typeof CircuitBreaker>[0]>): RoutingService {
  const cb = new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, openTimeoutMs: 500, halfOpenRequests: 2, ...overrides });
  const providers = new Map([
    ['stripe' as const, mockStripe],
    ['paypal' as const, mockPayPal],
    ['crypto' as const, mockCrypto],
  ]);
  return new RoutingService(providers, cb);
}

describe('RoutingService', () => {
  it('selects a provider that supports the currency and region', () => {
    const svc = makeRoutingService();
    const provider = svc.selectProvider({ currency: 'USD', region: 'us-east', amount: 1000, merchantId: 'm1' });
    expect(['stripe', 'paypal', 'crypto']).toContain(provider.id);
  });

  it('throws NoAvailableProviderError for unsupported currency in region', () => {
    const svc = makeRoutingService();
    // JPY is only supported by Stripe (us-east, us-west, eu-west, eu-central), not ap-southeast
    expect(() => svc.selectProvider({ currency: 'JPY', region: 'ap-southeast', amount: 1000, merchantId: 'm1' })).toThrow(NoAvailableProviderError);
  });

  it('excludes providers with open circuits', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, openTimeoutMs: 30000, halfOpenRequests: 2 });
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('paypal');
    cb.recordFailure('paypal');
    cb.recordFailure('paypal');

    const providers = new Map([
      ['stripe' as const, mockStripe],
      ['paypal' as const, mockPayPal],
      ['crypto' as const, mockCrypto],
    ]);
    const svc = new RoutingService(providers, cb);

    const provider = svc.selectProvider({ currency: 'USD', region: 'us-east', amount: 1000, merchantId: 'm1' });
    expect(provider.id).toBe('crypto');
  });

  it('throws NoAvailableProviderError when all providers have open circuits', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 30000, halfOpenRequests: 2 });
    cb.recordFailure('stripe');
    cb.recordFailure('paypal');
    cb.recordFailure('crypto');

    const providers = new Map([
      ['stripe' as const, mockStripe],
      ['paypal' as const, mockPayPal],
      ['crypto' as const, mockCrypto],
    ]);
    const svc = new RoutingService(providers, cb);

    expect(() => svc.selectProvider({ currency: 'USD', region: 'us-east', amount: 1000, merchantId: 'm1' })).toThrow(NoAvailableProviderError);
  });

  it('only crypto supports BTC in ap-southeast', () => {
    const svc = makeRoutingService();
    const provider = svc.selectProvider({ currency: 'BTC', region: 'ap-southeast', amount: 50000, merchantId: 'm2' });
    expect(provider.id).toBe('crypto');
  });

  it('selectProviderWithFallback excludes given providers', async () => {
    const svc = makeRoutingService();
    const provider = await svc.selectProviderWithFallback(
      { currency: 'USD', region: 'us-east', amount: 1000, merchantId: 'm1' },
      ['stripe', 'paypal'],
    );
    expect(provider.id).toBe('crypto');
  });

  it('getProviderById returns the correct provider', () => {
    const svc = makeRoutingService();
    expect(svc.getProviderById('stripe')?.id).toBe('stripe');
    expect(svc.getProviderById('paypal')?.id).toBe('paypal');
  });
});
