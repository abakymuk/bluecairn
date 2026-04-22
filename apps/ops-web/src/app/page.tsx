import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignInButton } from '@/components/sign-in-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isAllowedEmail } from '@/lib/allow-list'
import { auth } from '@/lib/auth'

/**
 * Landing page. Shows the sign-in card for unauthenticated visitors.
 * If a valid allow-listed session already exists, skip straight to
 * `/threads` — avoids the double-click for daily usage.
 */
export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session && isAllowedEmail(session.user.email)) {
    redirect('/threads')
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>BlueCairn ops-web</CardTitle>
          <CardDescription>
            Internal console for the ops pod. Sign in with your authorised Google account to
            continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignInButton />
          <p className="text-xs text-muted-foreground">
            Access is limited to explicit allow-listed emails. If you&apos;re not on the list,
            the login will succeed at Google but you&apos;ll see a 403 here.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
