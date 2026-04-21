/**
 * Bootstrap script: create the first internal tenant (bluecairn-internal).
 *
 * Idempotent — running twice does not duplicate rows. Looks up by natural
 * keys (slug, email, phone) before inserting.
 *
 * Run: bun run db:bootstrap
 * Requires: DATABASE_URL_ADMIN (to bypass RLS during seed).
 *
 * Matches Linear issue BLU-14.
 */

import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/schema/index.js'

const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL
if (!adminUrl) {
  console.error('DATABASE_URL_ADMIN or DATABASE_URL is required')
  process.exit(1)
}

const client = postgres(adminUrl, { max: 1 })
const db = drizzle(client, { schema })

async function bootstrap() {
  console.log('→ Bootstrapping bluecairn-internal tenant...')

  // Disable RLS for this session (admin only)
  await db.execute(sql`set local row_security = off`)

  // 1. Tenant
  const tenantSlug = 'bluecairn-internal'
  let [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, tenantSlug))

  if (!tenant) {
    ;[tenant] = await db
      .insert(schema.tenants)
      .values({
        slug: tenantSlug,
        legalName: 'BlueCairn Operations LLC',
        displayName: 'BlueCairn (Internal)',
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        status: 'active',
        plan: 'managed_full',
        onboardedAt: new Date(),
      })
      .returning()
    console.log(`  ✓ tenant created: ${tenant!.id}`)
  } else {
    console.log(`  = tenant exists: ${tenant.id}`)
  }

  // 2. Users (Vlad and Nick)
  const userSeeds = [
    {
      email: process.env.VLAD_EMAIL ?? 'vlad@bluecairn.app',
      phoneE164: process.env.VLAD_PHONE ?? '+15555550100',
      displayName: 'Vlad Ovelian',
      type: 'operator',
    },
    {
      email: process.env.NICK_EMAIL ?? 'nick@bluecairn.app',
      phoneE164: process.env.NICK_PHONE ?? '+15555550101',
      displayName: 'Nick Mikheev',
      type: 'operator',
    },
  ]

  const users: schema.User[] = []
  for (const seed of userSeeds) {
    let [user] = await db.select().from(schema.users).where(eq(schema.users.email, seed.email))
    if (!user) {
      ;[user] = await db.insert(schema.users).values(seed).returning()
      console.log(`  ✓ user created: ${user!.displayName} (${user!.id})`)
    } else {
      console.log(`  = user exists: ${user.displayName} (${user.id})`)
    }
    users.push(user!)
  }

  // 3. tenant_users — grant both as owners
  for (const user of users) {
    const existing = await db
      .select()
      .from(schema.tenantUsers)
      .where(eq(schema.tenantUsers.userId, user.id))
    if (existing.length === 0) {
      await db.insert(schema.tenantUsers).values({
        tenantId: tenant!.id,
        userId: user.id,
        role: 'owner',
      })
      console.log(`  ✓ grant: ${user.displayName} → owner of ${tenant!.slug}`)
    }
  }

  // 4. Telegram channel
  const chatId = process.env.BLUECAIRN_INTERNAL_TELEGRAM_CHAT_ID
  if (!chatId) {
    console.warn('  ! BLUECAIRN_INTERNAL_TELEGRAM_CHAT_ID not set — skipping channel + thread.')
    console.warn('    Set it after creating the bot and your Telegram group, then re-run.')
    await client.end()
    return
  }

  let [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.externalId, chatId))

  if (!channel) {
    ;[channel] = await db
      .insert(schema.channels)
      .values({
        tenantId: tenant!.id,
        kind: 'telegram',
        externalId: chatId,
        displayName: 'BlueCairn Internal Thread',
        isPrimary: true,
        active: true,
      })
      .returning()
    console.log(`  ✓ channel created: telegram / ${chatId}`)
  } else {
    console.log(`  = channel exists: telegram / ${chatId}`)
  }

  // 5. Thread
  const existingThreads = await db
    .select()
    .from(schema.threads)
    .where(eq(schema.threads.channelId, channel!.id))

  if (existingThreads.length === 0) {
    const [thread] = await db
      .insert(schema.threads)
      .values({
        tenantId: tenant!.id,
        channelId: channel!.id,
        kind: 'owner_primary',
        title: 'BlueCairn Internal',
      })
      .returning()
    console.log(`  ✓ thread created: ${thread!.id}`)
  } else {
    console.log(`  = thread exists: ${existingThreads[0]!.id}`)
  }

  console.log('\n✓ Bootstrap complete.')
  await client.end()
}

bootstrap().catch((err) => {
  console.error('✖ Bootstrap failed:', err)
  process.exit(1)
})
