import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/integrations.
 *
 * Pure unit tests — vendor SDKs (grammY, Twilio, etc.) are mocked so tests
 * are hermetic. Integration tests that actually hit a vendor API belong
 * in their consumer (e.g. @bluecairn/mcp-servers) with proper secrets.
 */

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts'],
    },
  },
})
