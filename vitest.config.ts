import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/workers/**', 'test/e2e/**', 'node_modules/**'],
        },
      },
      {
        // Live suite: self-skips unless E2E_BASE_URL and E2E_GATEWAY_KEY are set.
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['test/e2e/**/*.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
      {
        plugins: [
          cloudflareTest({ wrangler: { configPath: './test/workers/wrangler.test.jsonc' } }),
        ],
        test: {
          name: 'workers',
          include: ['test/workers/**/*.test.ts'],
        },
      },
    ],
  },
});
