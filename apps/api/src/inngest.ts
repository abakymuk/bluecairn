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

export const inngest = new Inngest({
  id: 'bluecairn-api',
  schemas: eventSchemas,
  ...(env.INNGEST_EVENT_KEY !== undefined && { eventKey: env.INNGEST_EVENT_KEY }),
})
