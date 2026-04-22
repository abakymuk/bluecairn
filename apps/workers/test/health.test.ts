import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'warn'
  process.env.PORT = '3001'
  // BLU-22: orchestrator-route.ts constructs the admin DB client at
  // module load; Zod validates `DATABASE_URL_ADMIN` is a URL. Provide a
  // dummy value so the health test doesn't need real DB access — the
  // postgres client is lazy and never connects without a query.
  process.env.DATABASE_URL_ADMIN ??= 'postgres://fake@localhost:5432/bluecairn'
})

describe('workers /health', () => {
  it('returns 200 with service=workers', async () => {
    const { app } = await import('../src/index.js')
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      service: string
      env: string
    }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('workers')
    expect(body.env).toBe('test')
  })
})
