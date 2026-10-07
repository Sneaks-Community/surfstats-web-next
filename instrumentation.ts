/** Next calls this once per server instance, before it accepts requests: the app's only startup
 * hook. `startServer()` is deliberately not awaited (see lib/startup.ts). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const [{ startServer }, { default: logger }, { getErrorMessage }] = await Promise.all([
    import('./lib/startup'),
    import('./lib/logger'),
    import('./lib/errors'),
  ]);

  void startServer().catch((error: unknown) => {
    logger.error(`[Startup] Failed: ${getErrorMessage(error)}`);
  });
}
