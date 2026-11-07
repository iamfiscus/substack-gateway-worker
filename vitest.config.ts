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
          exclude: ['test/workers/**', 'node_modules/**'],
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
