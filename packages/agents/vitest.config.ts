import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/agents.
 *
 * Unit tests only — mocks the AI SDK + Langfuse tracing so tests are
 * hermetic (no network, no Anthropic spend, no Langfuse dashboard noise).
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
