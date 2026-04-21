import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/db.
 *
 * Includes integration tests that talk to Postgres. Integration tests require
 * DATABASE_URL pointing to a test branch on Neon (or a local Postgres).
 *
 * Per BLU-12 (RLS adversarial tests): RLS tests go under `test/rls.test.ts`.
 */

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    globals: false,
    environment: 'node',
    // Integration tests against real DB may take longer than unit tests
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/schema/**/index.ts', 'src/index.ts'],
    },
  },
})
