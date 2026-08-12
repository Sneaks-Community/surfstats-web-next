import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), flush: vi.fn() };
vi.mock('../lib/logger', () => ({ default: logger }));

interface Global {
  __surfstatsShutdown?: unknown;
}

/**
 * Fresh module + global registry per test: the registry lives on globalThis, so
 * `vi.resetModules()` alone would carry the previous `shuttingDown` flag over.
 */
async function freshShutdown() {
  delete (globalThis as Global).__surfstatsShutdown;
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  vi.resetModules();
  return import('../lib/shutdown');
}

let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

/** Let the SIGTERM listener's async work settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('shutdown', () => {
  it('runs every handler once and exits 0', async () => {
    const { onShutdown } = await freshShutdown();
    const a = vi.fn();
    const b = vi.fn().mockResolvedValue(undefined);
    onShutdown('a', a);
    onShutdown('b', b);

    process.emit('SIGTERM');
    await settle();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  // It always exited 0, so a pool that refused to drain looked like a clean stop.
  it('exits non-zero when a handler fails, after running the others', async () => {
    const { onShutdown } = await freshShutdown();
    const ok = vi.fn();
    onShutdown('broken', () => Promise.reject(new Error('pool stuck')));
    onShutdown('ok', ok);

    process.emit('SIGTERM');
    await settle();

    expect(ok).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error.mock.calls[0][0]).toContain('"broken" failed');
  });

  it('replaces a handler registered under the same name instead of duplicating it', async () => {
    const { onShutdown } = await freshShutdown();
    const stale = vi.fn();
    const current = vi.fn();
    onShutdown('db-pool', stale);
    onShutdown('db-pool', current);

    process.emit('SIGTERM');
    await settle();

    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('ignores a second signal once shutdown is under way', async () => {
    const { onShutdown } = await freshShutdown();
    const handler = vi.fn();
    onShutdown('a', handler);

    process.emit('SIGTERM');
    process.emit('SIGINT');
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
