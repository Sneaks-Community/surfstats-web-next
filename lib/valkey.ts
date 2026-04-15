import { createClient } from 'redis';
import logger from './logger';

const client = createClient({
  url: process.env.VALKEY_URL || 'redis://localhost:6379',
  username: process.env.VALKEY_USERNAME,
  password: process.env.VALKEY_PASSWORD,
  socket: {
    tls: process.env.VALKEY_TLS === 'true',
    rejectUnauthorized: process.env.VALKEY_TLS_REJECT_UNAUTHORIZED !== 'false',
    connectTimeout: parseInt(process.env.VALKEY_CONNECT_TIMEOUT || '5000'),
  },
  retryStrategy: (times) => {
    // Exponential backoff with max delay of 5 seconds
    const delay = Math.min(times * 500, 5000);
    return delay;
  },
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

client.on('close', () => {
  logger.warn('[Valkey] Connection closed');
});

// Force connection on import
(async () => {
  if (!client.isOpen) {
    try {
      await client.connect();
    } catch (err) {
      const error = err as { message?: string };
      logger.error(`[Valkey] Failed to connect: ${error.message || 'Unknown error'}`);
    }
  }
})();

export default client;
