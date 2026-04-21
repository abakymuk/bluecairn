import { z } from 'zod'

/**
 * Environment variable contract for apps/workers. Fails fast at startup if
 * required vars are missing or malformed.
 *
 * Inngest keys are optional to allow local development via the Inngest CLI
 * (`bunx inngest-cli dev`) which auto-registers workers without a signing
 * key. Staging/production deploys must have both set; Doppler enforces this.
 *
 * See .env.example at repo root for the full list.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().startsWith('signkey-').optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`\n✖ Environment validation failed:\n${issues}\n`)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
