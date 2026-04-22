import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import postgres from 'postgres'

/**
 * Adversarial RLS test suite.
 *
 * Verifies that Row-Level Security enforces tenant isolation at the DB layer,
 * independent of any application-layer filtering. See ADR-0006 and BLU-12.
 *
 * Requires:
 *   DATABASE_URL        — bluecairn_app role (NOBYPASSRLS), subject to RLS
 *   DATABASE_URL_ADMIN  — bluecairn_admin role (table owner, bypasses RLS for setup)
 *
 * Run via: `doppler run --config dev -- bun run --cwd packages/db test`
 *
 * Fixture strategy: each run gets a unique TEST_PREFIX, so concurrent runs and
 * crashed runs leave disjoint trash. afterAll cleans up this run's tenants via
 * admin (CASCADE removes all dependent rows).
 */

const adminUrl = process.env.DATABASE_URL_ADMIN
const appUrl = process.env.DATABASE_URL

if (!adminUrl || !appUrl) {
  throw new Error('DATABASE_URL and DATABASE_URL_ADMIN required for RLS tests')
}

const TEST_PREFIX = `rls-test-${crypto.randomUUID().slice(0, 8)}`

const admin = postgres(adminUrl, { max: 1, prepare: false })
const app = postgres(appUrl, { max: 2, prepare: false })

let tenantAId: string
let tenantBId: string
let threadAId: string
let threadBId: string
let messageAId: string
let messageBId: string

beforeAll(async () => {
  const [a] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-a`}, 'Tenant A LLC', 'Tenant A')
    RETURNING id
  `
  const [b] = await admin<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${`${TEST_PREFIX}-b`}, 'Tenant B LLC', 'Tenant B')
    RETURNING id
  `
  if (!a || !b) throw new Error('fixture: tenant insert returned no rows')
  tenantAId = a.id
  tenantBId = b.id

  const [tA] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, title) VALUES (${tenantAId}, 'Thread A')
    RETURNING id
  `
  const [tB] = await admin<{ id: string }[]>`
    INSERT INTO threads (tenant_id, title) VALUES (${tenantBId}, 'Thread B')
    RETURNING id
  `
  if (!tA || !tB) throw new Error('fixture: thread insert returned no rows')
  threadAId = tA.id
  threadBId = tB.id

  const [mA] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content)
    VALUES (${tenantAId}, ${threadAId}, 'user', 'inbound', 'msg A')
    RETURNING id
  `
  const [mB] = await admin<{ id: string }[]>`
    INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content)
    VALUES (${tenantBId}, ${threadBId}, 'user', 'inbound', 'msg B')
    RETURNING id
  `
  if (!mA || !mB) throw new Error('fixture: message insert returned no rows')
  messageAId = mA.id
  messageBId = mB.id
})

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`}`
  await admin.end()
  await app.end()
})

/**
 * Helper: run `fn` inside a transaction with `app.current_tenant` set to `tenantId`
 * (or unset if null). The connection is `bluecairn_app`, which is subject to RLS.
 */
async function asApp<T>(tenantId: string | null, fn: (sql: typeof app) => Promise<T>): Promise<T> {
  return app.begin(async (sql) => {
    if (tenantId !== null) {
      await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`
    }
    return fn(sql as typeof app)
  }) as Promise<T>
}

describe('RLS tenant isolation', () => {
  test('1. session=A sees only A rows in threads', async () => {
    const rows = await asApp(tenantAId, (sql) => sql<{ id: string }[]>`SELECT id FROM threads`)
    expect(rows.map((r) => r.id)).toEqual([threadAId])
  })

  test('2. session=B sees only B rows in threads', async () => {
    const rows = await asApp(tenantBId, (sql) => sql<{ id: string }[]>`SELECT id FROM threads`)
    expect(rows.map((r) => r.id)).toEqual([threadBId])
  })

  test('3. no session variable set → empty result (not error)', async () => {
    const rows = await asApp(null, (sql) => sql<{ id: string }[]>`SELECT id FROM threads`)
    expect(rows).toHaveLength(0)
  })

  test('4. INSERT with foreign tenant_id is rejected by RLS CHECK', async () => {
    await expect(
      asApp(tenantAId, async (sql) => {
        // Attempt to smuggle a message into tenant B while session is tenant A
        await sql`
          INSERT INTO messages (tenant_id, thread_id, author_kind, direction, content)
          VALUES (${tenantBId}, ${threadBId}, 'user', 'inbound', 'smuggled')
        `
      }),
    ).rejects.toThrow(/row-level security|new row violates/i)
  })

  test('5. UPDATE on invisible row affects 0 rows', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`UPDATE threads SET title = 'pwned' WHERE id = ${threadBId}`
    })
    expect(result.count).toBe(0)
  })

  test('6. DELETE on invisible row affects 0 rows', async () => {
    const result = await asApp(tenantAId, async (sql) => {
      return sql`DELETE FROM messages WHERE id = ${messageBId}`
    })
    expect(result.count).toBe(0)

    // Verify the target still exists via admin
    const stillThere = await admin<{ id: string }[]>`
      SELECT id FROM messages WHERE id = ${messageBId}
    `
    expect(stillThere).toHaveLength(1)
  })

  test('7. subquery bypass attempt still filtered', async () => {
    // Craft a query that tries to leak cross-tenant rows via a subquery.
    // The outer SELECT on threads/messages is RLS-filtered regardless of
    // what the subquery returns.
    const rows = await asApp(tenantAId, async (sql) => {
      return sql<{ id: string; tenant_id: string }[]>`
        SELECT id, tenant_id FROM messages
        WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE ${`${TEST_PREFIX}%`})
      `
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tenant_id).toBe(tenantAId)
  })

  test('8. cross-table join does not leak B rows into A session', async () => {
    // Ensure a join between threads and messages only returns A-owned pairs
    const rows = await asApp(tenantAId, async (sql) => {
      return sql<{ t: string; m: string }[]>`
        SELECT threads.tenant_id AS t, messages.tenant_id AS m
        FROM threads JOIN messages ON messages.thread_id = threads.id
      `
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.t).toBe(tenantAId)
    expect(rows[0]?.m).toBe(tenantAId)
  })
})
