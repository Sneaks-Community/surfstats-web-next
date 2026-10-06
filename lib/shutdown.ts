import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';

type ShutdownHandler = () => void | Promise<void>;

interface ShutdownRegistry {
  /** Keyed by handler identity, valued by log label. */
  handlers: Map<ShutdownHandler, string>;
  listenersRegistered: boolean;
  shuttingDown: boolean;
}

// On globalThis: Next evaluates lib modules in several bundles per process (proxy, server, dev
// HMR), and a registry per bundle would fire shutdown several times on one Ctrl+C.
const globalForShutdown = globalThis as unknown as {
  __surfstatsShutdown?: ShutdownRegistry;
};

const registry: ShutdownRegistry = (globalForShutdown.__surfstatsShutdown ??= {
  handlers: new Map(),
  listenersRegistered: false,
  shuttingDown: false,
});

type SignalListener = (signal: string) => void;

// Bounded so a connection that never drains can't cost the pools their close; kept under
// Docker's default 10s stop_grace_period, the real deadline.
const DRAIN_TIMEOUT_MS = 8000;

// Runs the inherited listeners (Next's: stop accepting, finish in-flight requests, run `after()`).
// Their cleanup ends in `process.exit()`, which would skip our handlers, so exit becomes a resolve.
async function drainRequests(signal: string, listeners: SignalListener[]): Promise<void> {
  if (listeners.length === 0) return;

  const realExit = process.exit.bind(process);
  let timer: NodeJS.Timeout | undefined;

  try {
    await new Promise<void>(resolve => {
      timer = setTimeout(() => {
        logger.warn(`[Shutdown] Requests still draining after ${DRAIN_TIMEOUT_MS}ms, continuing`);
        resolve();
      }, DRAIN_TIMEOUT_MS);

      process.exit = ((code?: number) => {
        logger.debug(`[Shutdown] Server drained (suppressed exit ${code})`);
        resolve();
      }) as typeof process.exit;

      listeners.forEach(listener => {
        listener(signal);
      });
    });
  } finally {
    clearTimeout(timer);
    process.exit = realExit;
  }
}

// Drain, run each handler once, exit: owning the signal listener removes Node's default exit.
// Handlers get no timeout; they only stall on dead sockets, where the platform's SIGKILL after
// stop_grace_period is the backstop.
async function runShutdown(signal: string, inherited: SignalListener[]): Promise<void> {
  if (registry.shuttingDown) return;
  registry.shuttingDown = true;

  logger.info(`[Shutdown] Received ${signal}, draining requests...`);
  await drainRequests(signal, inherited);

  const handlers = [...registry.handlers.entries()];
  logger.info(`[Shutdown] Running ${handlers.length} cleanup handler(s)...`);

  let failed = 0;
  await Promise.allSettled(
    handlers.map(async ([handler, name]) => {
      try {
        await handler();
      } catch (error) {
        failed++;
        logger.error(`[Shutdown] Cleanup handler "${name}" failed: ${getErrorMessage(error)}`);
      }
    })
  );

  // Non-zero exit so an orchestrator can tell an unclean shutdown from a clean one.
  if (failed > 0) {
    logger.error(`[Shutdown] ${failed} cleanup handler(s) failed, exiting uncleanly`);
  } else {
    logger.info('[Shutdown] Cleanup complete, exiting');
  }

  // process.exit truncates pino's buffer; flush the line above first.
  logger.flush();
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Runs `handler` once on SIGTERM/SIGINT, concurrently with the rest; a failure is logged, not
 * blocking. Keyed by identity (registering twice runs once, each module copy keeps its own
 * entry); `name` is only a log label. No-op outside the server.
 */
export function onShutdown(name: string, handler: ShutdownHandler): void {
  if (typeof window !== 'undefined') return;

  registry.handlers.set(handler, name);

  if (!registry.listenersRegistered) {
    registry.listenersRegistered = true;
    takeOverSignal('SIGTERM');
    takeOverSignal('SIGINT');
  }
}

// Become the sole listener; Next's own, installed before `instrumentation.ts`, run first in
// drainRequests.


function takeOverSignal(signal: 'SIGTERM' | 'SIGINT'): void {
  const inherited = process.listeners(signal) as SignalListener[];
  process.removeAllListeners(signal);
  process.once(signal, () => void runShutdown(signal, inherited));
}
