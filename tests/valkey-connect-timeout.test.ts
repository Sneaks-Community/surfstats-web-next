import { describe, expect, it, vi } from 'vitest';

// Unreachable server: node-redis retries forever, so connect() never settles.
const connect = vi.fn(() => new Promise<never>(() => undefined));

vi.mock('redis', () => ({
  createClient: () => ({ isOpen: false, isReady: false, on: vi.fn(), connect }),
}));
vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../lib/shutdown', () => ({ onShutdown: vi.fn() }));

process.env.VALKEY_CONNECT_TIMEOUT = '50';
const { waitForCacheReady } = await import('../lib/valkey');

describe('waitForCacheReady', () => {
  it('gives up on an unreachable server so callers can fail closed', async () => {
    const start = Date.now();

    await expect(waitForCacheReady()).resolves.toBe(false);

    expect(Date.now() - start).toBeLessThan(2000);
    expect(connect).toHaveBeenCalled();
  });
});
