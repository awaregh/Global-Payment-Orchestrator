import type { PaymentProvider } from '../../domain/interfaces/payment-provider';
import type { RoutingContext, ProviderId } from '../../domain/types';
import type { CircuitBreaker } from '../../infrastructure/circuit-breaker';
import { metrics } from '../../infrastructure/observability/metrics';
import { NoAvailableProviderError } from '../../domain/errors';
import { logger } from '../../infrastructure/observability/logger';
import { config } from '../../config';

interface ProviderScore {
  provider: PaymentProvider;
  score: number;
}

interface RoutingWeights {
  latency: number;
  successRate: number;
  cost: number;
}

const PROVIDER_BASE_COSTS: Record<ProviderId, number> = {
  stripe: 0.029,
  paypal: 0.034,
  crypto: 0.01,
};

export class RoutingService {
  private readonly weights: RoutingWeights;

  constructor(
    private readonly providers: Map<ProviderId, PaymentProvider>,
    private readonly circuitBreaker: CircuitBreaker,
    weights?: Partial<RoutingWeights>,
  ) {
    this.weights = {
      latency: weights?.latency ?? config.routing.latencyWeight,
      successRate: weights?.successRate ?? config.routing.successRateWeight,
      cost: weights?.cost ?? config.routing.costWeight,
    };
  }

  selectProvider(ctx: RoutingContext): PaymentProvider {
    const candidates = this.getCandidates(ctx);

    if (candidates.length === 0) {
      throw new NoAvailableProviderError(
        `No provider supports currency=${ctx.currency} in region=${ctx.region}`,
      );
    }

    const scored = this.scoreProviders(candidates);

    if (scored.length === 0) {
      throw new NoAvailableProviderError('All eligible providers have open circuit breakers');
    }

    const selected = scored[0]!;

    logger.info(
      {
        selectedProvider: selected.provider.id,
        score: selected.score,
        candidates: scored.map((s) => ({ id: s.provider.id, score: s.score })),
        ctx,
      },
      'Provider selected for routing',
    );

    return selected.provider;
  }

  async selectProviderWithFallback(
    ctx: RoutingContext,
    excludeProviders: ProviderId[] = [],
  ): Promise<PaymentProvider> {
    const candidates = this.getCandidates(ctx).filter(
      (p) => !excludeProviders.includes(p.id),
    );

    if (candidates.length === 0) {
      throw new NoAvailableProviderError(
        `No fallback provider available for currency=${ctx.currency} in region=${ctx.region}`,
      );
    }

    const scored = this.scoreProviders(candidates);

    if (scored.length === 0) {
      throw new NoAvailableProviderError('All fallback providers have open circuit breakers');
    }

    return scored[0]!.provider;
  }

  private getCandidates(ctx: RoutingContext): PaymentProvider[] {
    const results: PaymentProvider[] = [];
    for (const provider of this.providers.values()) {
      const supportsCurrency = provider.supportedCurrencies.includes(ctx.currency);
      const supportsRegion = provider.supportedRegions.includes(ctx.region);
      if (supportsCurrency && supportsRegion) {
        results.push(provider);
      }
    }
    return results;
  }

  private scoreProviders(candidates: PaymentProvider[]): ProviderScore[] {
    const scored: ProviderScore[] = [];

    for (const provider of candidates) {
      if (!this.circuitBreaker.isAvailable(provider.id)) {
        continue;
      }

      const providerStats = metrics.getProviderStats(provider.id);
      const score = this.computeScore(provider.id, providerStats.successRate, providerStats.avgLatencyMs);

      scored.push({ provider, score });
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  private computeScore(
    providerId: ProviderId,
    successRate: number,
    avgLatencyMs: number,
  ): number {
    const normalizedLatency = Math.max(0, 1 - avgLatencyMs / 2000);
    const normalizedCost = 1 - (PROVIDER_BASE_COSTS[providerId] / 0.05);

    return (
      successRate * this.weights.successRate +
      normalizedLatency * this.weights.latency +
      normalizedCost * this.weights.cost
    );
  }

  getProviderById(id: ProviderId): PaymentProvider | undefined {
    return this.providers.get(id);
  }
}
