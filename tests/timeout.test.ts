import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';

vi.mock('../lib/logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { applyStatementTimeout, withTimeout } = await import('../lib/timeout');

/** Minimal stand-in for a pool and the callback-style connection it emits. */
function fakePool(opts: { isMariaDB: boolean; rejectFirst?: boolean }) {
  const pool = new EventEmitter() as unknown as Pool;
  const executed: string[] = [];
  const connect = async () => {
    const conn = {
      _isMariaDB: opts.isMariaDB,
      promise: () => ({
        query: (sql: string) => {
          executed.push(sql);
          return opts.rejectFirst && executed.length === 1
            ? Promise.reject(new Error('Unknown system variable'))
            : Promise.resolve([]);
        },
      }),
    };
    (pool as unknown as EventEmitter).emit('connection', conn);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { pool, executed, connect };
}

afterEach(() => {
  delete process.env.DB_STATEMENT_TIMEOUT_MS;
});

describe('applyStatementTimeout', () => {
  it('uses MariaDB seconds on MariaDB, in one round trip', async () => {
    const { pool, executed, connect } = fakePool({ isMariaDB: true });

    applyStatementTimeout(pool, 'TEST');
    await connect();

    expect(executed).toEqual(['SET SESSION max_statement_time=8']);
  });

  it('uses MySQL milliseconds elsewhere, in one round trip', async () => {
    const { pool, executed, connect } = fakePool({ isMariaDB: false });

    applyStatementTimeout(pool, 'TEST');
    await connect();

    expect(executed).toEqual(['SET SESSION max_execution_time=8000']);
  });

  // The vendor flag is a driver internal; if it ever disappears the fallback
  // must still cap the statement rather than silently leave it uncapped.
  it('falls back to the other spelling when the first is rejected', async () => {
    const { pool, executed, connect } = fakePool({ isMariaDB: true, rejectFirst: true });

    applyStatementTimeout(pool, 'TEST');
    await connect();

    expect(executed).toEqual([
      'SET SESSION max_statement_time=8',
      'SET SESSION max_execution_time=8000',
    ]);
  });

  it('honours DB_STATEMENT_TIMEOUT_MS', async () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = '5000';
    const { pool, executed, connect } = fakePool({ isMariaDB: true });

    applyStatementTimeout(pool, 'TEST');
    await connect();

    expect(executed).toEqual(['SET SESSION max_statement_time=5']);
  });

  it('sets nothing when disabled with 0', async () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = '0';
    const { pool, executed, connect } = fakePool({ isMariaDB: true });

    applyStatementTimeout(pool, 'TEST');
    await connect();

    expect(executed).toEqual([]);
  });
});

describe('withTimeout', () => {
  it('resolves a promise that beats the timer', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with the given message once the timer wins', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => undefined), 30_000, 'Query timed out');
    const assertion = expect(pending).rejects.toThrow('Query timed out');

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    vi.useRealTimers();
  });

  it('passes the underlying rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('DB down')), 1000)).rejects.toThrow('DB down');
  });
});
