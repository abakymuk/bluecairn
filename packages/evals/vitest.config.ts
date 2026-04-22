import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @bluecairn/evals.
 *
 * Unit tests cover the assertion helpers + JSONL case loader (pure
 * functions). The runner itself is exercised end-to-end via
 * `bun run eval <agent>`; that is not a unit test and is not run here.
 */

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
    environment: 'node',
  },
})
