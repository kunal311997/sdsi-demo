import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // node:sqlite is synchronous and per-process; forks give each test file its
    // own process, which keeps in-memory databases fully isolated.
    pool: 'forks',
    reporters: ['default'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // index.ts is the process bootstrap (exercised by the smoke test in CI);
      // types.ts contains only type declarations, which emit no code.
      exclude: ['src/index.ts', 'src/types/**', 'src/domain/types.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70,
      },
    },
  },
});
