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
 *
 * ────────────────────────────────────────────────────────────────────────
 * THIS FILE LIVED AT THE REPOSITORY ROOT AND THEREFORE NEVER RAN.
 *
 * Next resolves middleware next to the app directory. This project keeps its
 * app under `src/`, so `src/middleware.ts` is the path that is compiled and
 * `./middleware.ts` is a file Next silently ignores. It gave no warning, and
 * the only visible symptom was the absence of one:
 *
 *   $ cat .next/server/middleware-manifest.json
 *   { "sortedMiddleware": [], "middleware": {}, ... }
 *
 * Measured against production on 2026-08-10, before the move: GET
 * /admin/dashboard, /developer/dashboard and /client all answered 200 to an
 * anonymous request instead of redirecting to /login.
 *
 * What that did NOT cost: the pages are client-rendered and fetch their data
 * with a bearer token, so the anonymous HTML contained no tenant data, and
 * /api/productivity still answered 401. The API guard and RLS were doing the
 * real work the whole time — which is exactly why nobody noticed.
 *
 * What it did cost: the navigation gate this file describes did not exist, so
 * the product was one layer of defence short of what it claimed.
 *
 * If a future change moves this file again, the check is the manifest above —
 * not whether the code looks right.
 * ────────────────────────────────────────────────────────────────────────
 */

// Which session user_type may enter each area. Staff roles all share the
// /developer surface, so anything that is not a client or admin lands there.
const AREA_RULES: { prefix: string; allow: (userType: string | null | undefined) => boolean }[] = [
  { prefix: '/admin', allow: (t) => t === 'admin' },
  { prefix: '/client', allow: (t) => t === 'client' },
  { prefix: '/developer', allow: (t) => t === 'developer' || t === 'admin' },
]

/**
 * Public pages that happen to sit UNDER a protected prefix.
 *
 * `/admin/registration` is the create-an-organization flow. By definition
 * nobody holds a session there — it is where sessions come from. Without this
 * exemption, switching the middleware on turns signup into an immediate
 * redirect to /login, which is to say it takes the product off sale. It is
 * listed first because it is the reason this list exists at all.
 *
 * Matched with startsWith so a nested route under the same page is covered.
 * Everything else under /admin, /developer and /client requires a session —
 * including /admin/upgrade, which a locked but signed-in admin reaches.
 */
const PUBLIC_PATHS = ['/admin/registration']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next()

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
