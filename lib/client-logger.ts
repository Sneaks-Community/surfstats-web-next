// For client code, where Pino (server-only) cannot run.

const isDevelopment = process.env.NODE_ENV === 'development';

/** `console.error` in development, suppressed in production; `error` is optional context. */
export function clientError(message: string, error?: unknown): void {
  if (isDevelopment) {
    console.error(`[Client] ${message}`, error || '');
  }
}
