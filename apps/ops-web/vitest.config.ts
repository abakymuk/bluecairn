import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest for ops-web. happy-dom gives us a browser-shaped DOM fast
 * enough for RSC-independent component tests. We deliberately don't
 * test Server Components end-to-end here — that's the domain of the
 * Next.js build + a future Playwright pass.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
