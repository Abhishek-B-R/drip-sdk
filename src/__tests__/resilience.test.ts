import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drip } from '../index.js';
import { CircuitBreakerOpenError, DEFAULT_RETRY_CONFIG, ResilienceManager } from '../resilience.js';
import { DripError } from '../errors.js';

describe('ResilienceManager circuit breaker', () => {
  it('does not open the circuit on client errors (4xx)', async () => {
    const manager = new ResilienceManager();
    const notFound = () => Promise.reject(new DripError('Customer not found', 404, 'NOT_FOUND'));

    for (let i = 0; i < 10; i++) {
      await expect(manager.execute(notFound)).rejects.toBeInstanceOf(DripError);
    }

    expect(manager.circuitBreaker.getState()).toBe('closed');
    await expect(manager.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('still opens the circuit on server errors', async () => {
    const manager = new ResilienceManager({
      retry: { ...DEFAULT_RETRY_CONFIG, maxRetries: 0 },
    });
    const serverError = () => Promise.reject(new DripError('Internal error', 500));

    for (let i = 0; i < 5; i++) {
      await expect(manager.execute(serverError)).rejects.toBeInstanceOf(DripError);
    }

    expect(manager.circuitBreaker.getState()).toBe('open');
    await expect(manager.execute(() => Promise.resolve('ok'))).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });
});

describe('Drip client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps serving requests after repeated 404 lookups', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('cus_missing')) {
        return new Response(JSON.stringify({ error: 'Customer not found', code: 'NOT_FOUND' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'cus_ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const drip = new Drip({ apiKey: 'sk_test_1234567890', baseUrl: 'https://drip.test/v1' });

    for (let i = 0; i < 5; i++) {
      await expect(drip.getCustomer('cus_missing')).rejects.toMatchObject({ statusCode: 404 });
    }

    await expect(drip.getCustomer('cus_ok')).resolves.toMatchObject({ id: 'cus_ok' });
  });
});
