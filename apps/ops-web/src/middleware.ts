import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge middleware for ops-web (BLU-26).
 *
 * Fast-path gate for `/threads` + any future authed route. Cookie
 * presence check only — full session validation (and the email
 * allow-list) runs server-side in `(authed)/layout.tsx` where we have
 * the Better Auth API surface available.
 *
 * Rationale: Better Auth's `getSession` is a Node-runtime DB call, not
 * edge-safe. The cookie check lets us redirect a logged-out visitor
 * immediately without the RSC round-trip; the layout does the
 * authoritative check before rendering protected content.
 *
 * Matcher excludes static assets, Next.js internals, /api/auth (must be
 * reachable during login), /api/health (Railway probe), and /
 * (landing is always public).
 */
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  const { pathname } = request.nextUrl

  // Early return for the landing page — it's public and handles its own
  // redirect-if-authed logic.
  if (pathname === '/') {
    return NextResponse.next()
  }

  if (!sessionCookie) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /**
     * Run on every request EXCEPT:
     *   - /api/auth/*       Better Auth endpoints (must be reachable)
     *   - /api/health       Railway probe
     *   - /_next/*          Next.js static + internal
     *   - /favicon.ico, /robots.txt
     *   - /*.png, /*.svg    etc. (bundled static assets)
     */
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
}
