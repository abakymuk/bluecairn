import { eventSchemas } from '@bluecairn/core'
import { Inngest } from 'inngest'
import { env } from './env.js'

/**
 * Shared Inngest client for apps/workers. Uses the typed `eventSchemas`
 * from @bluecairn/core so every `.send()` and function trigger is checked
 * against the canonical Zod schemas.
 *
 * In local dev without INNGEST_EVENT_KEY the Inngest CLI (`bunx inngest-cli
 * dev`) proxies events to this handler. Staging/prod require both keys.
 */

export const inngest = new Inngest({
  id: 'bluecairn-workers',
  schemas: eventSchemas,
  ...(env.INNGEST_EVENT_KEY !== undefined && { eventKey: env.INNGEST_EVENT_KEY }),
  ...(env.INNGEST_SIGNING_KEY !== undefined && { signingKey: env.INNGEST_SIGNING_KEY }),
})
