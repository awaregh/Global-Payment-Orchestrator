import { config } from '../../config';
import { CircuitOpenError } from '../../domain/errors';
import type { ProviderId } from '../../domain/types';
import { logger } from '../observability/logger';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  halfOpenRequests: number;
}

export class CircuitBreaker {
  private readonly circuits = new Map<ProviderId, CircuitBreakerState>();
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openTimeoutMs: number;
  private readonly halfOpenRequests: number;

  constructor(opts?: {
    failureThreshold?: number;
    successThreshold?: number;
    openTimeoutMs?: number;
    halfOpenRequests?: number;
  }) {
    this.failureThreshold = opts?.failureThreshold ?? config.circuitBreaker.failureThreshold;
    this.successThreshold = opts?.successThreshold ?? config.circuitBreaker.successThreshold;
    this.openTimeoutMs = opts?.openTimeoutMs ?? config.circuitBreaker.openTimeoutMs;
    this.halfOpenRequests = opts?.halfOpenRequests ?? config.circuitBreaker.halfOpenRequests;
  }

  private getState(providerId: ProviderId): CircuitBreakerState {
    if (!this.circuits.has(providerId)) {
      this.circuits.set(providerId, {
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        halfOpenRequests: 0,
      });
    }
    return this.circuits.get(providerId)!;
  }

  isAvailable(providerId: ProviderId): boolean {
    const circuit = this.getState(providerId);

    if (circuit.state === 'closed') return true;

    if (circuit.state === 'open') {
      const now = Date.now();
      if (circuit.lastFailureTime !== null && now - circuit.lastFailureTime >= this.openTimeoutMs) {
        circuit.state = 'half-open';
        circuit.halfOpenRequests = 0;
        logger.info({ providerId }, 'Circuit breaker transitioning to half-open');
        return true;
      }
      return false;
    }

    // half-open: allow limited requests
    if (circuit.halfOpenRequests < this.halfOpenRequests) {
      circuit.halfOpenRequests++;
      return true;
    }
    return false;
  }

  recordSuccess(providerId: ProviderId): void {
    const circuit = this.getState(providerId);

    if (circuit.state === 'half-open') {
      circuit.successCount++;
      if (circuit.successCount >= this.successThreshold) {
        this.reset(providerId);
        logger.info({ providerId }, 'Circuit breaker closed after recovery');
      }
      return;
    }

    if (circuit.state === 'closed') {
      circuit.failureCount = Math.max(0, circuit.failureCount - 1);
    }
  }

  recordFailure(providerId: ProviderId): void {
    const circuit = this.getState(providerId);
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === 'half-open') {
      circuit.state = 'open';
      circuit.successCount = 0;
      logger.warn({ providerId }, 'Circuit breaker re-opened after half-open failure');
      return;
    }

    if (circuit.failureCount >= this.failureThreshold) {
      circuit.state = 'open';
      logger.warn({ providerId, failureCount: circuit.failureCount }, 'Circuit breaker opened');
    }
  }

  assertAvailable(providerId: ProviderId): void {
    if (!this.isAvailable(providerId)) {
      throw new CircuitOpenError(providerId);
    }
  }

  getCircuitState(providerId: ProviderId): CircuitState {
    return this.getState(providerId).state;
  }

  private reset(providerId: ProviderId): void {
    this.circuits.set(providerId, {
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      halfOpenRequests: 0,
    });
  }

  async execute<T>(providerId: ProviderId, fn: () => Promise<T>): Promise<T> {
    this.assertAvailable(providerId);
    try {
      const result = await fn();
      this.recordSuccess(providerId);
      return result;
    } catch (err) {
      this.recordFailure(providerId);
      throw err;
    }
  }
}

export const circuitBreaker = new CircuitBreaker();
