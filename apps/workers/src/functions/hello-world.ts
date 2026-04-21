import { inngest } from '../inngest.js'
import { logger } from '../lib/logger.js'

/**
 * hello-world — the BLU-18 smoke function. Subscribes to `debug.ping` events
 * to verify Inngest registration, the event schema pipeline, and the logger
 * all wire up end-to-end. Delete or repurpose once real functions land in
 * BLU-22 / BLU-23.
 */

export const helloWorld = inngest.createFunction(
  { id: 'hello-world', name: 'Hello World' },
  { event: 'debug.ping' },
  async ({ event, step }) => {
    await step.run('log-ping', async () => {
      logger.info('debug.ping received', {
        pingId: event.data.ping_id,
        ...(event.data.tenant_id !== undefined && { tenantId: event.data.tenant_id }),
      })
    })
    return {
      ok: true,
      ping_id: event.data.ping_id,
      received_at: new Date().toISOString(),
    }
  },
)
