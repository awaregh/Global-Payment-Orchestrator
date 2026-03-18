import { CircuitBreaker } from './index';
import { CircuitOpenError } from '../../domain/errors';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      openTimeoutMs: 500,
      halfOpenRequests: 2,
    });
  });

  it('starts in closed state', () => {
    expect(cb.getCircuitState('stripe')).toBe('closed');
    expect(cb.isAvailable('stripe')).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    expect(cb.getCircuitState('stripe')).toBe('closed');

    cb.recordFailure('stripe');
    expect(cb.getCircuitState('stripe')).toBe('open');
    expect(cb.isAvailable('stripe')).toBe(false);
  });

  it('throws CircuitOpenError when assertAvailable on open circuit', () => {
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');

    expect(() => cb.assertAvailable('stripe')).toThrow(CircuitOpenError);
  });

  it('transitions to half-open after timeout', async () => {
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    expect(cb.getCircuitState('stripe')).toBe('open');

    await new Promise((r) => setTimeout(r, 600));
    expect(cb.isAvailable('stripe')).toBe(true);
    expect(cb.getCircuitState('stripe')).toBe('half-open');
  });

  it('closes after enough successes in half-open', async () => {
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');

    await new Promise((r) => setTimeout(r, 600));
    cb.isAvailable('stripe');

    cb.recordSuccess('stripe');
    expect(cb.getCircuitState('stripe')).toBe('half-open');
    cb.recordSuccess('stripe');
    expect(cb.getCircuitState('stripe')).toBe('closed');
  });

  it('re-opens on failure in half-open state', async () => {
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');

    await new Promise((r) => setTimeout(r, 600));
    cb.isAvailable('stripe');

    cb.recordFailure('stripe');
    expect(cb.getCircuitState('stripe')).toBe('open');
  });

  it('tracks circuits independently per provider', () => {
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');
    cb.recordFailure('stripe');

    expect(cb.getCircuitState('stripe')).toBe('open');
    expect(cb.getCircuitState('paypal')).toBe('closed');
    expect(cb.isAvailable('paypal')).toBe(true);
  });

  it('execute wraps fn and records success', async () => {
    const result = await cb.execute('stripe', async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getCircuitState('stripe')).toBe('closed');
  });

  it('execute records failure and rethrows on fn error', async () => {
    const err = new Error('provider down');
    await expect(cb.execute('stripe', async () => { throw err; })).rejects.toThrow('provider down');
    await expect(cb.execute('stripe', async () => { throw err; })).rejects.toThrow();
    await expect(cb.execute('stripe', async () => { throw err; })).rejects.toThrow();
    expect(cb.getCircuitState('stripe')).toBe('open');
  });
});
