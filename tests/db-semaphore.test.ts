import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Read at import time, so they have to be set before the dynamic import below.
process.env.DB_MAX_CONCURRENT_EXPENSIVE = '1';
process.env.DB_MAX_QUEUED_EXPENSIVE = '1';

const { withExpensiveQueryLimit } = await import('../lib/db-semaphore');
const { DbBusyError } = await import('../lib/errors');

/** A query we control the completion of, so slots stay held while we assert. */
function pending() {
  let done!: () => void;
  const gate = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { done, run: () => withExpensiveQueryLimit(() => gate) };
}

describe('withExpensiveQueryLimit', () => {
  it('sheds once the queue is full and recovers when slots free up', async () => {
    const running = pending();
    const queued = pending();

    const first = running.run(); // takes the only slot
    const second = queued.run(); // takes the only queue place
    // Nothing left to wait in: shed rather than grow the backlog.
    await expect(withExpensiveQueryLimit(() => Promise.resolve('third'))).rejects.toBeInstanceOf(
      DbBusyError
    );

    running.done();
    await first;
    queued.done();
    await second;

    // Queue drained, so the next caller is served normally again.
    await expect(withExpensiveQueryLimit(() => Promise.resolve('later'))).resolves.toBe('later');
  });

  it('releases the slot when the query throws', async () => {
    await expect(
      withExpensiveQueryLimit(() => Promise.reject(new Error('query failed')))
    ).rejects.toThrow('query failed');
    await expect(withExpensiveQueryLimit(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
