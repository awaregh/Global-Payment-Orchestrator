import type { ProviderId } from '../../domain/types';

interface ProviderMetric {
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  samples: number;
}

class MetricsRegistry {
  private readonly providerMetrics = new Map<ProviderId, ProviderMetric>();
  private requestCount = 0;
  private readonly latencyHistogram: number[] = [];

  recordProviderCall(providerId: ProviderId, success: boolean, latencyMs: number): void {
    const existing = this.providerMetrics.get(providerId) ?? {
      successCount: 0,
      failureCount: 0,
      totalLatencyMs: 0,
      samples: 0,
    };

    this.providerMetrics.set(providerId, {
      successCount: existing.successCount + (success ? 1 : 0),
      failureCount: existing.failureCount + (success ? 0 : 1),
      totalLatencyMs: existing.totalLatencyMs + latencyMs,
      samples: existing.samples + 1,
    });
  }

  recordRequest(latencyMs: number): void {
    this.requestCount++;
    this.latencyHistogram.push(latencyMs);
    if (this.latencyHistogram.length > 10_000) {
      this.latencyHistogram.shift();
    }
  }

  getProviderStats(providerId: ProviderId): {
    successRate: number;
    avgLatencyMs: number;
    totalCalls: number;
  } {
    const m = this.providerMetrics.get(providerId);
    if (!m || m.samples === 0) {
      return { successRate: 1, avgLatencyMs: 100, totalCalls: 0 };
    }
    return {
      successRate: m.successCount / m.samples,
      avgLatencyMs: m.totalLatencyMs / m.samples,
      totalCalls: m.samples,
    };
  }

  getSystemStats(): {
    requestCount: number;
    p50LatencyMs: number;
    p99LatencyMs: number;
    providers: Record<string, ReturnType<MetricsRegistry['getProviderStats']>>;
  } {
    const sorted = [...this.latencyHistogram].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

    const providers: Record<string, ReturnType<MetricsRegistry['getProviderStats']>> = {};
    for (const [id] of this.providerMetrics) {
      providers[id] = this.getProviderStats(id);
    }

    return {
      requestCount: this.requestCount,
      p50LatencyMs: p50,
      p99LatencyMs: p99,
      providers,
    };
  }
}

export const metrics = new MetricsRegistry();
