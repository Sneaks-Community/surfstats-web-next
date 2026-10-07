import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only lib/ logic is unit-tested: components would need a DOM runner, which we don't have.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    alias: {
      // 'server-only' throws outside a Server Component. Use the empty module Next resolves under the
      // react-server condition, by file path since the exports map only offers it there.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
      '@/': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
