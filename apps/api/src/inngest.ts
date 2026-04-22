import { eventSchemas } from '@bluecairn/core'
import { Inngest } from 'inngest'
import { env } from './env.js'

/**
 * Inngest client for apps/api — sender-only. apps/api does not register
 * durable functions (those live in apps/workers); this client exists purely
 * to publish events like `thread.message.received` from the webhook edge.
 *
 * Shares the canonical `eventSchemas` from @bluecairn/core so `.send()` is
 * typed against the same contracts workers consume (ADR-0004).
 *
 * The event key is optional to keep local dev ergonomic — the Inngest dev
 * server (`bunx inngest-cli dev`) proxies without a key. Staging/prod must
 * have INNGEST_EVENT_KEY populated in Doppler.
 */

// Inngest SDK auto-detects dev vs cloud from NODE_ENV. Staging runs with
// NODE_ENV=staging (not 'production') — without explicit `isDev: false` the
// SDK would route `.send()` to http://localhost:8288/e/dev instead of
// Inngest Cloud. Force cloud mode when the event key is present.
export const inngest = new Inngest({
  id: 'bluecairn-api',
  schemas: eventSchemas,
  isDev: env.INNGEST_EVENT_KEY === undefined,
  ...(env.INNGEST_EVENT_KEY !== undefined && { eventKey: env.INNGEST_EVENT_KEY }),
})
