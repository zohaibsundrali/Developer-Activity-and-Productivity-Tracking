import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/utils/sessionCookie'

/**
 * Route protection.
 *
 * SECURITY (audit finding C5): this used to check only that a cookie named
 * `admin_auth` / `developer_auth` / `client_auth` was PRESENT. Those cookies are
 * written by the browser with `document.cookie`, so typing
 * `document.cookie="admin_auth=true"` was enough to reach the admin console.
 *
 * It now verifies an HMAC-signed, HttpOnly session cookie issued server-side by
 * /api/auth/session after the Supabase JWT has been validated, and checks that
 * the session's user type actually matches the area being entered.
 *
 * Note: the API layer does not rely on this. Every protected route independently
 * verifies the caller's JWT via getAuthedOrg, and RLS is role-scoped as of
 * migration 018 — this is the UI-navigation gate, not the data gate.
 */

// Which session user_type may enter each area. Staff roles all share the
// /developer surface, so anything that is not a client or admin lands there.
const AREA_RULES: { prefix: string; allow: (userType: string | null | undefined) => boolean }[] = [
  { prefix: '/admin', allow: (t) => t === 'admin' },
  { prefix: '/client', allow: (t) => t === 'client' },
  { prefix: '/developer', allow: (t) => t === 'developer' || t === 'admin' },
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const rule = AREA_RULES.find((r) => pathname.startsWith(r.prefix))
  if (!rule) return NextResponse.next()

  const raw = request.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(raw)

  if (!session) {
    const url = new URL('/login', request.url)
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  if (!rule.allow(session.userType)) {
    // Signed in, but not for this area — send them to login rather than
    // leaking which areas exist.
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/developer/:path*',
    '/admin/:path*',
    '/client/:path*'
  ]
}
