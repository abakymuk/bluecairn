import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'warn'
  process.env.PORT = '3001'
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
