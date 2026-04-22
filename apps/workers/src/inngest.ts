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

// Inngest SDK auto-detects dev vs cloud mode from NODE_ENV. Our staging
// runs with NODE_ENV=staging (not 'production'), so without an explicit
// `isDev: false` the SDK defaults to dev mode and tries to connect to
// http://localhost:8288/dev — which manifested as stuck functions after
// BLU-36 sync and "SDK response was not signed" errors in the Inngest
// Dashboard. When both cloud keys are present, force cloud mode.
const hasCloudKeys =
  env.INNGEST_EVENT_KEY !== undefined && env.INNGEST_SIGNING_KEY !== undefined

export const inngest = new Inngest({
  id: 'bluecairn-workers',
  schemas: eventSchemas,
  isDev: !hasCloudKeys,
  ...(env.INNGEST_EVENT_KEY !== undefined && { eventKey: env.INNGEST_EVENT_KEY }),
  ...(env.INNGEST_SIGNING_KEY !== undefined && { signingKey: env.INNGEST_SIGNING_KEY }),
})
