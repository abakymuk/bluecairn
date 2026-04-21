import { z } from 'zod'

/**
 * Environment variable contract. Fail fast at startup if required vars
 * are missing or malformed — do not limp into production with bad config.
 *
 * See .env.example at repo root for the full list.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database — DATABASE_URL uses bluecairn_app (RLS-subject) for tenant-scoped
  // request handlers. DATABASE_URL_ADMIN uses bluecairn_admin (table owner,
  // bypasses RLS) for pre-tenant-context operations like webhook channel
  // resolution.
  DATABASE_URL: z.string().url(),
  DATABASE_URL_ADMIN: z.string().url(),

  // Telegram (ADR-0009)
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16, 'webhook secret must be at least 16 chars'),

  // Langfuse (optional in dev, required in staging+prod)
  LANGFUSE_HOST: z.string().url().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),

  // LLM providers. Prefixed-optional keys use .catch(undefined) so a parent
  // shell leaking a non-matching value (e.g. Claude Code setting
  // ANTHROPIC_API_KEY for its own use) doesn't break boot — the key is
  // treated as unset. Actual usage fails loudly at call time if needed.
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional().catch(undefined),
  OPENAI_API_KEY: z.string().startsWith('sk-').optional().catch(undefined),

  // Inngest (ADR-0004) — optional so local dev can run against the Inngest
  // dev CLI without a cloud key. Staging/prod populate from Doppler.
  INNGEST_EVENT_KEY: z.string().min(1).optional(),

  // Orchestrator feature flag (BLU-19). When false, the webhook falls back
  // to the M0 inline path (persist only, no event emit). Default true on
  // dev/staging; toggle via Doppler if the orchestrator misbehaves.
  ORCHESTRATOR_ENABLED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('true'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`\n✖ Environment validation failed:\n${issues}\n`)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
