'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Fires `router.refresh()` on a fixed interval. Mounted under an authed
 * page, it re-fetches the Server Component's data without a full reload.
 *
 * BLU-27 AC #6: poll at 5 s. SSE / websockets explicitly deferred.
 * The interval is intentionally low for M1 dogfood — if the ops pod
 * feels the refresh noise later, we dial it up or gate it per-route.
 */
export function AutoRefresh({ intervalMs = 5000 }: { readonly intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(timer)
  }, [router, intervalMs])

  return null
}
