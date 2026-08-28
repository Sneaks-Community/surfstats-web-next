import { createClient } from 'redis';
import logger from './logger';
import { onShutdown } from './shutdown';

const valkeyUrl = process.env.VALKEY_URL || 'redis://localhost:6379';
const valkeyUsername = process.env.VALKEY_USERNAME;
const valkeyPassword = process.env.VALKEY_PASSWORD;
const valkeyTls = process.env.VALKEY_TLS === 'true';
const valkeyTlsRejectUnauthorized = process.env.VALKEY_TLS_REJECT_UNAUTHORIZED !== 'false';
const valkeyConnectTimeout = parseInt(process.env.VALKEY_CONNECT_TIMEOUT || '5000', 10) || 5000;

// Exponential backoff (100ms, doubling) capped at 30s. node-redis calls this
// once per reconnect attempt with the retry counter and the failure cause, so
// it's the one place to emit an informative per-attempt log line. Returning a
// number (never false/Error) preserves the default behavior of retrying
// indefinitely.
function reconnectStrategy(retries: number, cause: Error): number {
  const delay = Math.min(2 ** retries * 100, 30_000);
  logger.warn(
    `[Valkey] Reconnect attempt #${retries + 1} failed: ${cause.message}. Next retry in ${delay}ms (backoff, capped at 30000ms).`
  );
  return delay;
}

// Build socket options conditionally to satisfy TypeScript types
const socketOptions: {
  tls?: true;
  rejectUnauthorized?: boolean;
  connectTimeout?: number;
  reconnectStrategy: (retries: number, cause: Error) => number;
} = valkeyTls
  ? { tls: true, rejectUnauthorized: valkeyTlsRejectUnauthorized, connectTimeout: valkeyConnectTimeout, reconnectStrategy }
  : { connectTimeout: valkeyConnectTimeout, reconnectStrategy };

function createValkey() {
  const client = createClient({
    url: valkeyUrl,
    username: valkeyUsername,
    password: valkeyPassword,
    socket: socketOptions,
  });

  client.on('error', (err: Error) => {
    logger.error(`[Valkey] Client error: ${err.message}`);
  });

  client.on('connect', () => {
    logger.info('[Valkey] Connected');
  });

  client.on('reconnecting', () => {
    logger.warn('[Valkey] Reconnecting...');
  });

  // Force connection on import. Kept as a promise so callers can await the
  // initial attempt instead of racing it — otherwise the very first request
  // after startup sees isReady === false and gets a 503 before the handshake
  // has had a chance to complete.
  //
  // VALKEY_CONNECT_TIMEOUT caps one socket attempt, not connect(), which retries
  // forever, so bound the whole wait or callers hang instead of failing closed.
  const initialConnect: Promise<void> = (async () => {
    if (client.isOpen) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out after ${valkeyConnectTimeout}ms`)),
            valkeyConnectTimeout
          );
        }),
      ]);
    } catch (err) {
      const error = err as { message?: string };
      logger.error(`[Valkey] Failed to connect: ${error.message || 'Unknown error'}`);
    } finally {
      clearTimeout(timer);
    }
  })();

  // Graceful shutdown: quit the client so in-flight commands drain and the
  // connection closes cleanly instead of being reset when the process exits.
  onShutdown('valkey-client', async () => {
    if (client.isOpen) {
      await client.quit();
      logger.info('[Valkey] Connection closed gracefully');
    }
  });

  return { client, initialConnect };
}

// Next evaluates lib modules in several bundles per process, so a module-scoped
// client opens one connection per copy, and a caller landing in a copy still
// mid-handshake sees isReady === false and fails closed while another copy is
// happily serving. Same shape as the registry in lib/shutdown.ts.
const globalForValkey = globalThis as unknown as {
  __surfstatsValkey?: ReturnType<typeof createValkey>;
};

const { client, initialConnect } = (globalForValkey.__surfstatsValkey ??= createValkey());

// How long a caller waits on a handshake that is still in flight. Covers a slow
// first connect and the early reconnect backoff steps without making a real
// outage feel hung, since every request pays this before its 503.
const READY_WAIT_MS = 1_000;

// One shared waiter rather than one per caller: a precache sweep asks thousands
// of times, and a listener each would blow past the emitter's max.
let readyWait: Promise<boolean> | undefined;

function waitForReadyEvent(): Promise<boolean> {
  readyWait ??= new Promise<boolean>(resolve => {
    const settle = (ready: boolean): void => {
      clearTimeout(timer);
      client.off('ready', onReady);
      readyWait = undefined;
      resolve(ready);
    };
    const onReady = (): void => { settle(true); };
    const timer = setTimeout(() => {
      logger.warn(
        `[Valkey] Not ready after ${READY_WAIT_MS}ms, failing closed (isOpen=${client.isOpen})`
      );
      settle(false);
    }, READY_WAIT_MS);
    client.once('ready', onReady);
  });
  return readyWait;
}

/**
 * Whether the cache can serve, waiting out a handshake that is still in flight.
 *
 * `initialConnect` is not enough on its own: it is bounded by a wall-clock timer
 * that races `connect()`, so it can settle while the socket is still connecting,
 * and it is one-shot, so it does nothing for a steady-state reconnect. Without
 * the second wait both windows turn every caller into an instant hard failure.
 */
export async function waitForCacheReady(): Promise<boolean> {
  // Read through a call: as a property, the first check narrows the second to
  // `false` even though the state changes across the await.
  const ready = (): boolean => client.isReady;

  if (ready()) return true;
  await initialConnect;
  return ready() || waitForReadyEvent();
}

export default client;
