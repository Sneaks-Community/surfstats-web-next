import { describe, expect, it, vi } from 'vitest';

// Unreachable server: node-redis retries forever, so connect() never settles.
const connect = vi.fn(() => new Promise<never>(() => undefined));
const listeners = new Map<string, () => void>();
const client = {
  isOpen: false,
  isReady: false,
  on: vi.fn(),
  once: vi.fn((event: string, fn: () => void) => listeners.set(event, fn)),
  off: vi.fn((event: string) => listeners.delete(event)),
  connect,
};

vi.mock('redis', () => ({ createClient: () => client }));
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

    expect(Date.now() - start).toBeLessThan(3000);
    expect(connect).toHaveBeenCalled();
  });

  // The initial-connect promise is bounded by a wall-clock race and is one-shot,
  // so on its own it reports "down" for a handshake that is merely still in
  // flight — which turned one slow boot into a flood of hard failures.
  it('waits out a handshake still in flight instead of failing closed', async () => {
    const pending = waitForCacheReady();

    // The socket becomes ready after the initial attempt already gave up.
    await new Promise(resolve => setTimeout(resolve, 100));
    client.isReady = true;
    listeners.get('ready')?.();

    await expect(pending).resolves.toBe(true);
  });
});
