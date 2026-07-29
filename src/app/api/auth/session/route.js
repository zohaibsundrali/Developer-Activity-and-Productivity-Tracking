import { NextResponse } from "next/server";
import { getAuthedOrg } from "@/utils/serverAuth";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
} from "@/utils/sessionCookie";

export const dynamic = "force-dynamic";

/**
 * Exchange a verified Supabase JWT for a signed, HttpOnly session cookie that
 * the middleware can validate (audit finding C5).
 *
 * The browser cannot forge this cookie: it is signed server-side with a secret
 * that never leaves the server, and it is set with HttpOnly so client-side
 * JavaScript cannot read or overwrite it.
 *
 * POST   — called right after a successful login, with the Supabase access
 *          token in the Authorization header. Also re-checks membership status,
 *          because getAuthedOrg rejects deactivated members.
 * DELETE — called on logout to clear the cookie.
 */
export async function POST(request) {
  const auth = await getAuthedOrg(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const value = await signSession({
    userType: auth.userType,
    role: auth.role,
    orgId: auth.orgId,
  });
  if (!value) {
    // No signing secret available — refuse rather than issue an unsigned cookie.
    return NextResponse.json(
      { error: "Session signing is not configured on the server" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
