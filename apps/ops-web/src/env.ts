import { z } from 'zod'

/**
 * ops-web environment schema. Fails fast at startup if any required var
 * is missing or malformed. Next.js invokes `env.ts` during build AND at
 * runtime (via module import from server components / route handlers).
 *
 * CI builds on main use stub values — real secrets live in Doppler
 * (`dev`, `stg` configs). See apps/ops-web/README.md.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),

  // --- Database (shared with the rest of the monorepo) ---
  DATABASE_URL: z.string().url(),
  DATABASE_URL_ADMIN: z.string().url().optional(),

  // --- Better Auth (BLU-26) ---
  // Secret used to sign session cookies + CSRF tokens. Rotate via
  // `BETTER_AUTH_SECRET_PREVIOUS` if needed (Better Auth accepts a
  // comma-separated list for rolling rotation).
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  // Base URL Better Auth uses to construct OAuth redirect URIs. On
  // staging/prod this matches the Railway public URL; in dev it's
  // http://localhost:3002.
  BETTER_AUTH_URL: z.string().url(),

  // Google OAuth credentials — provisioned in Google Cloud Console.
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Comma-separated email allow-list. Any session whose
  // `user.email` is not in this list gets 403 from the middleware /
  // authed layout. Keep tight in M1 — Vlad + Nick only.
  OPS_WEB_ALLOWED_EMAILS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),

  // Railway-injected on deploy — exposed via /api/health for BLU-36
  // SHA-match CI step. `unknown` in local dev.
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  RAILWAY_DEPLOYMENT_ID: z.string().optional(),

  // Langfuse deep-link (BLU-27) — used by timeline-item to link every
  // agent_run card to its trace in Langfuse Cloud. Optional: if either
  // var is missing the "Langfuse" link is omitted gracefully.
  LANGFUSE_HOST: z.string().url().optional(),
  LANGFUSE_PROJECT_ID: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`\n✖ Environment validation failed (apps/ops-web):\n${issues}\n`)
  // Don't `process.exit(1)` — Next.js re-imports during build and we want
  // the stack trace surfaced cleanly. Throw so the build fails loudly.
  throw new Error('ops-web environment validation failed')
}

export const env = parsed.data
export type Env = typeof env
