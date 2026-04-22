import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAllowedEmail } from '@/lib/allow-list'
import { auth } from '@/lib/auth'

/**
 * Every page under `/(authed)/*` is gated by this layout. Two checks:
 *
 *   1. Session exists — otherwise redirect to `/`.
 *   2. Session owner is on the ops-pod allow-list — otherwise render
 *      a 403 panel. We intentionally do NOT redirect a non-allowed
 *      user; showing the explicit 403 helps debug membership issues.
 *
 * The `middleware.ts` at the edge performs the same two checks against
 * the session cookie for faster rejection. This layout is the
 * server-side fallback — critical for any request that slips past
 * middleware (e.g. Next.js RSC streaming edge cases).
 */
export default async function AuthedLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    redirect('/')
  }

  if (!isAllowedEmail(session.user.email)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-4xl font-semibold">403</h1>
        <p className="max-w-md text-center text-muted-foreground">
          Signed in as <span className="font-mono">{session.user.email}</span>, but that email is
          not on the ops-pod allow-list. Ask Vlad to add you to
          <code className="mx-1">OPS_WEB_ALLOWED_EMAILS</code>
          in Doppler.
        </p>
      </main>
    )
  }

  return <div className="min-h-screen">{children}</div>
}
