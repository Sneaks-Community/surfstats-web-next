import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';

type ShutdownHandler = () => void | Promise<void>;

interface ShutdownRegistry {
  /** Keyed by handler identity, valued by log label. See {@link onShutdown}. */
  handlers: Map<ShutdownHandler, string>;
  listenersRegistered: boolean;
  shuttingDown: boolean;
}

// Next.js evaluates lib modules in several separate bundles within one process
// (middleware graph, server graph, and dev HMR re-evaluations), so a
// module-scoped registry would give each instance its own handler list and its
// own signal listeners — firing shutdown multiple times on a single Ctrl+C.
// Anchoring the registry on globalThis makes every instance in the process share
// one handler map and one pair of listeners.
const globalForShutdown = globalThis as unknown as {
  __surfstatsShutdown?: ShutdownRegistry;
};

const registry: ShutdownRegistry = (globalForShutdown.__surfstatsShutdown ??= {
  handlers: new Map(),
  listenersRegistered: false,
  shuttingDown: false,
});

type SignalListener = (signal: string) => void;

// Bounded so a connection that never drains cannot cost the pools their close.
// Kept under Docker's default 10s stop_grace_period, which is the real deadline.
const DRAIN_TIMEOUT_MS = 8000;

/**
 * Hand the signal to the listeners that were already installed (Next's: it stops
 * accepting connections, finishes in-flight requests and runs pending `after()`
 * callbacks), and resolve when they try to exit.
 *
 * Next's cleanup ends in `process.exit()` and awaits nothing this app
 * registered, which is why every handler below used to be skipped. Swapping
 * `process.exit` for a resolve while it runs turns that exit into "the server is
 * drained, carry on".
 */
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

/**
 * Drain the HTTP server, then run every registered handler once, then exit.
 * Installing a SIGTERM/SIGINT listener removes Node's default "terminate on
 * signal" behavior, so this is responsible for exiting the process itself.
 *
 * The handlers themselves have no internal timeout: the connection drains
 * (`pool.end()`, `client.quit()`) return promptly when dependencies are
 * reachable and only stall when the sockets are already dead — in which case the
 * platform's post-`stop_grace_period` SIGKILL is the backstop, rather than a
 * hand-tuned constant here.
 */
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
 * Register a cleanup callback to run once on process shutdown (SIGTERM/SIGINT).
 *
 * Handlers are keyed by identity in a process-global registry: the same callback
 * registered twice runs once, while two coexisting module instances (proxy and
 * server bundles, a dev HMR reload) each keep their own entry. All instances
 * share a single pair of signal listeners. Handlers may be async and are awaited
 * concurrently; a throwing/rejecting one is logged and skipped so a single
 * failure doesn't block the rest. No-op outside the server.
 *
 * @param name - Log label for this handler (e.g. "db-pool"); not an identity.
 * @param handler - Cleanup callback.
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

/**
 * Become the only listener for `signal`, keeping whatever was installed before
 * (Next registers its own during server start, ahead of `instrumentation.ts`) to
 * run first inside {@link drainRequests}.
 */
function takeOverSignal(signal: 'SIGTERM' | 'SIGINT'): void {
  const inherited = process.listeners(signal) as SignalListener[];
  process.removeAllListeners(signal);
  process.once(signal, () => void runShutdown(signal, inherited));
}
