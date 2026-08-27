import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';

const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../lib/logger', () => ({ default: logger }));

const { wrapPoolQuery } = await import('../lib/db-query-logger');

/** Minimal stand-in for a mysql2 pool: only `query`/`execute` are wrapped. */
function fakePool(result: unknown = [[]]): Pool {
  return {
    query: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue(result),
  } as unknown as Pool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wrapPoolQuery', () => {
  it('logs one debug line per query and passes the result through', async () => {
    const pool = fakePool([[{ n: 1 }]]);
    wrapPoolQuery(pool, { prefix: 'DB' });

    expect(await pool.query('SELECT 1')).toEqual([[{ n: 1 }]]);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug.mock.calls[0][0]).toContain('SELECT 1');
  });

  // A re-evaluated module used to wrap the previous wrapper, double-logging.
  it('wraps a pool only once, however many times it is called', async () => {
    const pool = fakePool();
    wrapPoolQuery(pool, { prefix: 'DB' });
    wrapPoolQuery(pool, { prefix: 'DB' });
    wrapPoolQuery(pool, { prefix: 'DB' });

    await pool.query('SELECT 1');

    expect(logger.debug.mock.calls.filter((call) => String(call[0]).includes('SELECT 1'))).toHaveLength(1);
  });

  // `execute` was left unwrapped, silently losing slow-query logging.
  it('logs `execute` as well as `query`', async () => {
    const pool = fakePool();
    wrapPoolQuery(pool, { prefix: 'DB' });

    await pool.execute('SELECT 2');

    expect(logger.debug.mock.calls.some((call) => String(call[0]).includes('SELECT 2'))).toBe(true);
  });

  it('logs and rethrows a query error rather than returning an empty result', async () => {
    const pool = fakePool();
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('gone away'), { code: 'PROTOCOL_CONNECTION_LOST' })
    );
    wrapPoolQuery(pool, { prefix: 'DB' });

    await expect(pool.query('SELECT 1')).rejects.toThrow('gone away');
    expect(logger.error.mock.calls[0][0]).toContain('PROTOCOL_CONNECTION_LOST');
  });

  // mysql2 rejects with a plain, code-less Error here, which read as an
  // anonymous "Database error (UNKNOWN)" and hid pool exhaustion.
  it('names a full connection queue as a pool failure, not a query error', async () => {
    const pool = fakePool();
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Queue limit reached.')
    );
    wrapPoolQuery(pool, { prefix: 'DB' });

    await expect(pool.query('SELECT 1')).rejects.toThrow('Queue limit reached.');
    expect(logger.error.mock.calls[0][0]).toContain('Connection queue full');
    expect(logger.error.mock.calls[0][0]).not.toContain('UNKNOWN');
  });

  it('warns on a query slower than the threshold', async () => {
    const pool = fakePool();
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([[]]), 15))
    );
    wrapPoolQuery(pool, { prefix: 'DB', slowThresholdMs: 5 });

    await pool.query('SELECT SLEEP(1)');

    expect(logger.warn.mock.calls[0][0]).toContain('Slow query detected');
  });
});
