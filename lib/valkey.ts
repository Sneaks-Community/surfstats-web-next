import { createClient } from 'redis';
import logger from './logger';
import { getErrorMessage } from './errors';
import { onShutdown } from './shutdown';
import { getEnv } from './env';

const {
  VALKEY_URL: valkeyUrl,
  VALKEY_USERNAME: valkeyUsername,
  VALKEY_PASSWORD: valkeyPassword,
  VALKEY_TLS: valkeyTls,
  VALKEY_TLS_REJECT_UNAUTHORIZED: valkeyTlsRejectUnauthorized,
  VALKEY_CONNECT_TIMEOUT: valkeyConnectTimeout,
} = getEnv();

// Called by node-redis per reconnect attempt, so it's where the per-attempt log lives. Always
// returns a delay (never false/Error), which keeps it retrying indefinitely.
function reconnectStrategy(retries: number, cause: Error): number {
  const delay = Math.min(2 ** retries * 100, 30_000);
  logger.warn(
    `[Valkey] Reconnect attempt #${retries + 1} failed: ${cause.message}. Next retry in ${delay}ms (backoff, capped at 30000ms).`
  );
  return delay;
}

// Built conditionally to satisfy the client's TypeScript socket types.
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

  // Connects on import; awaitable so the first request doesn't 503 mid-handshake. connect()
  // retries forever (VALKEY_CONNECT_TIMEOUT caps one attempt), so bound the whole wait or
  // callers hang instead of failing closed.
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
    } catch (error) {
      logger.error(`[Valkey] Failed to connect: ${getErrorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  })();

  // quit() drains in-flight commands instead of the connection being reset on exit.
  onShutdown('valkey-client', async () => {
    if (client.isOpen) {
      await client.quit();
      logger.info('[Valkey] Connection closed gracefully');
    }
  });

  return { client, initialConnect };
}

// On globalThis: Next evaluates lib modules in several bundles per process, so a module-scoped
// client would open a connection per copy, and one still mid-handshake fails closed while
// another serves.
const globalForValkey = globalThis as unknown as {
  __surfstatsValkey?: ReturnType<typeof createValkey>;
};

const { client, initialConnect } = (globalForValkey.__surfstatsValkey ??= createValkey());

// Wait on an in-flight handshake: covers a slow first connect and early reconnect backoff, yet
// short, since during a real outage every request pays it before its 503.
const READY_WAIT_MS = 1_000;

// Shared waiter: a precache sweep asks thousands of times, past the emitter's listener max.
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
 * Whether the cache can serve, waiting out an in-flight handshake. `initialConnect` alone can
 * settle (timed out) mid-connect and is one-shot, so it misses steady-state reconnects.
 */

export async function waitForCacheReady(): Promise<boolean> {
  // A call, not a property: TS would narrow the second check to `false` across the await.

  const ready = (): boolean => client.isReady;

  if (ready()) return true;
  await initialConnect;
  return ready() || waitForReadyEvent();
}

export default client;
