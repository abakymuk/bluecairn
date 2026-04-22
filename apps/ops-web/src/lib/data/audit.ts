import { schema } from '@bluecairn/db'
import { db } from '@/lib/db'

/**
 * Write an `ops_web_read` row to `audit_log` (BLU-27 AC#4).
 *
 * Every thread-list fetch + every thread-detail fetch calls this.
 * Keeps the ops-pod compliance trail regulator-ready: you can answer
 * "who read which tenant's threads when" from SQL alone.
 *
 * `auth_user_id` is populated from the Better Auth session. The domain
 * `user_id` column stays null — ops-pod operators don't have domain user
 * rows, and the `audit_log.auth_user_id` column was added in migration
 * 0006 specifically to bridge that gap.
 *
 * Best-effort write: never throws. The ops-web pages render correctly
 * even if the audit insert fails — the failure is logged and we move on
 * (auditing a page view is observability, not correctness). For
 * pathological DB outage the read itself would already fail upstream.
 */
export async function auditOpsWebRead(args: {
  authUserId: string
  authUserEmail: string
  path: string
  tenantId?: string | null
  threadId?: string | null
  summary: string
  extra?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      tenantId: args.tenantId ?? null,
      authUserId: args.authUserId,
      eventKind: 'ops_web_read',
      eventSummary: args.summary,
      eventPayload: {
        auth_user_id: args.authUserId,
        auth_user_email: args.authUserEmail,
        path: args.path,
        tenant_id: args.tenantId ?? null,
        thread_id: args.threadId ?? null,
        ...(args.extra ?? {}),
      },
    })
  } catch (err) {
    // Intentional console.error — Next.js surfaces to the Railway log
    // stream, and we want a signal without failing the page render.
    console.error('audit_log ops_web_read insert failed', {
      authUserId: args.authUserId,
      path: args.path,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
