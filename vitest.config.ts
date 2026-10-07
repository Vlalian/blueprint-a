import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{gates,adapters,test}/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/fixtures/**'],
    // Several tests start node and git; under load (Windows especially) they can exceed 5 s.
    testTimeout: 30_000,
  },
});
