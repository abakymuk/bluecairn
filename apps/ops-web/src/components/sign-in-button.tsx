'use client'

import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signIn } from '@/lib/auth-client'

/**
 * Client-side "Sign in with Google" button. Triggers Better Auth's
 * social-login flow — on success the user lands back on the
 * `callbackURL` which we route to `/threads`. Allow-list enforcement
 * happens server-side on the next request (middleware + authed layout).
 */
export function SignInButton() {
  const [isPending, setIsPending] = useState(false)

  return (
    <Button
      onClick={async () => {
        setIsPending(true)
        try {
          await signIn.social({
            provider: 'google',
            callbackURL: '/threads',
          })
        } catch (err) {
          // Surface to operator — they know to reach out in Slack.
          console.error('sign-in error', err)
          setIsPending(false)
        }
      }}
      disabled={isPending}
      size="lg"
    >
      <LogIn className="h-4 w-4" aria-hidden />
      {isPending ? 'Redirecting…' : 'Sign in with Google'}
    </Button>
  )
}
