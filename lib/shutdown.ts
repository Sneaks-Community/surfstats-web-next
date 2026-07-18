import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';

type ShutdownHandler = () => void | Promise<void>;

interface ShutdownRegistry {
  handlers: Map<string, ShutdownHandler>;
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

/**
 * Run every registered handler once, then exit. Installing a SIGTERM/SIGINT
 * listener removes Node's default "terminate on signal" behavior, so this is
 * responsible for exiting the process itself.
 *
 * There is intentionally no internal timeout: the connection drains
 * (`pool.end()`, `client.quit()`) return promptly when dependencies are
 * reachable and only stall when the sockets are already dead — in which case the
 * platform's post-`stop_grace_period` SIGKILL is the backstop, rather than a
 * hand-tuned constant here.
 */
async function runShutdown(signal: string): Promise<void> {
  if (registry.shuttingDown) return;
  registry.shuttingDown = true;

  const handlers = [...registry.handlers.values()];
  logger.info(`[Shutdown] Received ${signal}, running ${handlers.length} cleanup handler(s)...`);

  await Promise.allSettled(
    handlers.map(async (handler) => {
      try {
        await handler();
      } catch (error) {
        logger.error(`[Shutdown] Cleanup handler failed: ${getErrorMessage(error)}`);
      }
    })
  );

  logger.info('[Shutdown] Cleanup complete, exiting');
  process.exit(0);
}

/**
 * Register a cleanup callback to run once on process shutdown (SIGTERM/SIGINT).
 *
 * Handlers are keyed by `name` in a process-global registry, so registering the
 * same name again (a re-evaluated module) replaces the previous entry rather
 * than accumulating duplicates, and all instances share a single pair of signal
 * listeners. Handlers may be async and are awaited concurrently; a
 * throwing/rejecting one is logged and skipped so a single failure doesn't block
 * the rest. No-op outside the server.
 *
 * @param name - Stable identifier for this handler (e.g. "db-pool").
 * @param handler - Cleanup callback.
 */
export function onShutdown(name: string, handler: ShutdownHandler): void {
  if (typeof window !== 'undefined') return;

  registry.handlers.set(name, handler);

  if (!registry.listenersRegistered) {
    registry.listenersRegistered = true;
    process.once('SIGTERM', () => void runShutdown('SIGTERM'));
    process.once('SIGINT', () => void runShutdown('SIGINT'));
  }
}
