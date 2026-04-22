'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth-client'

/**
 * Client-side sign-out. On success, redirect to `/` (landing); the
 * subsequent GET will be unauthenticated and show the sign-in card.
 */
export function SignOutButton() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  return (
    <Button
      onClick={async () => {
        setIsPending(true)
        try {
          await signOut()
          router.push('/')
          router.refresh()
        } catch (err) {
          console.error('sign-out error', err)
          setIsPending(false)
        }
      }}
      disabled={isPending}
      variant="outline"
      size="sm"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
