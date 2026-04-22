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

  // Admin-role DB URL — workers operate in system context; RLS boundaries
  // enforced via `withTenant()` wrappers on writes.
  DATABASE_URL_ADMIN: z.string().url(),

  // Telegram (ADR-0009). Workers need it so `action.gate` can call
  // `comms.send_message` in-process (BLU-25). The grammY Bot instance is
  // constructed once at module load via `createTelegramBot`.
  TELEGRAM_BOT_TOKEN: z.string().min(1),

  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().startsWith('signkey-').optional(),

  // Langfuse (optional in dev without Doppler; required in staging+prod).
  LANGFUSE_HOST: z.string().url().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),

  // LLM providers. `.catch(undefined)` handles the Claude-Code parent-shell
  // leak where `ANTHROPIC_API_KEY` doesn't start with `sk-ant-` — same
  // pattern as apps/api/src/env.ts. Actual calls fail loud at call time
  // if the key is required and missing.
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional().catch(undefined),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`\n✖ Environment validation failed:\n${issues}\n`)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
