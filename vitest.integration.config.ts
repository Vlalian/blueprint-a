import { defineConfig } from 'vitest/config';

// Slow tests that run the real tools (Stryker, vitest, Jest) to prove the gates bite.
// `npm run test:integration`.
export default defineConfig({
  test: {
    include: ['{gates,adapters}/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/fixtures/**'],
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    fileParallelism: false,
  },
});
