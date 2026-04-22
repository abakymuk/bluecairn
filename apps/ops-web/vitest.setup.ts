/**
 * Vitest setup — runs before every test file.
 *
 * 1. Stub the env vars `src/env.ts` requires, so importing any module
 *    that indirectly pulls `env` (via `@/lib/langfuse-url`, etc.)
 *    doesn't blow up during test boot.
 * 2. Register `@testing-library/react`'s `afterEach(cleanup)` so the
 *    DOM resets between tests.
 */

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.DATABASE_URL_ADMIN = 'postgresql://test-admin:test@localhost:5432/test'
process.env.BETTER_AUTH_SECRET = 'test-stub-better-auth-secret-at-least-32-chars-long-please'
process.env.BETTER_AUTH_URL = 'http://localhost:3002'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.OPS_WEB_ALLOWED_EMAILS = 'test@example.com'
process.env.LANGFUSE_HOST = 'https://us.cloud.langfuse.com'
process.env.LANGFUSE_PROJECT_ID = 'test-project-id'

afterEach(() => {
  cleanup()
})
