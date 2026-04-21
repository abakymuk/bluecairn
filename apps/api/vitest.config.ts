import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/api.
 *
 * Covers route handlers (webhooks, health) via Hono's app.fetch(new Request(...))
 * pattern — no need to boot an actual HTTP server for tests.
 */

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    globals: false,
    environment: 'node',
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/index.ts'],
    },
  },
})
