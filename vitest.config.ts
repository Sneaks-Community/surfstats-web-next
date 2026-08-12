import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Specs live in tests/; only lib/ has unit-testable logic, since components
    // need a DOM runner we don't have.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    alias: {
      // Server modules import 'server-only', which throws outside a React
      // Server Component. Point at the same empty module Next uses under the
      // react-server condition; by file path, since the package's exports map
      // only offers it under that condition.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
      '@/': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
