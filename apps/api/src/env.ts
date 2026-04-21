import { z } from 'zod'

/**
 * Environment variable contract. Fail fast at startup if required vars
 * are missing or malformed — do not limp into production with bad config.
 *
 * See .env.example at repo root for the full list.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Telegram (ADR-0009)
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16, 'webhook secret must be at least 16 chars'),

  // Langfuse (optional in dev, required in staging+prod)
  LANGFUSE_HOST: z.string().url().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),

  // LLM providers
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
  OPENAI_API_KEY: z.string().startsWith('sk-').optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`\n✖ Environment validation failed:\n${issues}\n`)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
