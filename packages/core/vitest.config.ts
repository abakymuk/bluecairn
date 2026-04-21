import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/core.
 *
 * Pure unit tests only — no database, no network, no external mocks.
 * Fast (<10ms per test target).
 */

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/index.ts'],
    },
  },
})
