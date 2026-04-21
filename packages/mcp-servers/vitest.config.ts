import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/mcp-servers.
 *
 * Integration tests hit a real Postgres (DATABASE_URL_ADMIN). Telegram
 * Bot is mocked at the grammY boundary so tests don't spend API calls.
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
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts'],
    },
  },
})
