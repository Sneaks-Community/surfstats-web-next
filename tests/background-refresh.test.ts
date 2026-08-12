import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../lib/logger', () => ({ default: logger }));
vi.mock('../lib/shutdown', () => ({ onShutdown: vi.fn() }));

const { createBackgroundRefresh } = await import('../lib/background-refresh');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createBackgroundRefresh', () => {
  it('runs the task immediately, then on the interval', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    createBackgroundRefresh({ name: 'interval-case', intervalMs: 1000, task }).start();

    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(task).toHaveBeenCalledTimes(3);
  });

  // The timer handle lives on globalThis so a second module evaluation can't start
  // a second copy of a task. Two controllers sharing a name is that situation.
  it('does not start a second copy of a task already running under the same name', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    createBackgroundRefresh({ name: 'shared-name', intervalMs: 1000, task: first }).start();
    createBackgroundRefresh({ name: 'shared-name', intervalMs: 1000, task: second }).start();

    await vi.advanceTimersByTimeAsync(2500);

    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(3);
  });

  it('is idempotent when the same controller is started twice', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const refresh = createBackgroundRefresh({ name: 'double-start', intervalMs: 1000, task });

    refresh.start();
    refresh.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  // The analytics health probe's "one probe, no re-check" mode.
  it('runs once and installs no timer when the interval is disabled', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    createBackgroundRefresh({ name: 'no-interval', intervalMs: 0, task }).start();

    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('keeps the loop alive when the task throws', async () => {
    const task = vi.fn().mockRejectedValue(new Error('transient'));
    createBackgroundRefresh({ name: 'throwing', intervalMs: 1000, task }).start();

    await vi.advanceTimersByTimeAsync(2000);

    expect(task).toHaveBeenCalledTimes(3);
    expect(logger.error.mock.calls[0][0]).toContain('Background refresh failed');
  });
});
