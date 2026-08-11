import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";
import {
  normalizeEmail,
  hashCode,
  digestsEqual,
  MAX_ATTEMPTS,
} from "@/utils/verificationCodes";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify-code — check a signup verification code.
 *
 * This endpoint is the thing that did not exist. The code used to be generated
 * by the browser, kept in React state, and compared by the browser, so the
 * check could be skipped by posting straight to /api/auth/signup, or defeated
 * by reading the value out of devtools. /api/send-verification now mints and
 * stores the code; this route is where it is proven; /api/auth/signup refuses
 * an address that has not been through here.
 *
 * It runs BEFORE the user has any session, so like the send route it cannot
 * require a JWT. What protects it instead:
 *
 *   - one live code per address at a time (the send route retires the previous
 *     one), so resending moves the window rather than widening it
 *   - a per-row attempt cap, which is what actually stops a six-digit code
 *     being walked; a rate limit on sending does not help here, because
 *     guessing sends nothing
 *   - a ten-minute expiry that is now a stored column rather than a sentence
 *     in an email
 *   - constant-time digest comparison
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it returns the same "invalid or expired"
 * message whether the address was never issued a code, the code has expired,
 * the attempts are used up, or the digits are simply wrong. Distinguishing
 * those would turn this into an oracle for which addresses are mid-signup.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? "").trim();

    if (!email || !/^\d{4,8}$/.test(code)) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    const svc = serviceClient();
    const nowIso = new Date().toISOString();

    // Newest row for this address. ORDERED — an unordered limit(1) returns an
    // arbitrary row in physical order, which after a resend is as likely to be
    // the retired code as the live one.
    const { data: rows, error } = await svc
      .from("email_verifications")
      .select("id, code_hash, expires_at, verified_at, consumed_at, attempts")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[verify-code]", error.message);
      return NextResponse.json({ error: "Could not verify right now." }, { status: 503 });
    }

    const row = rows?.[0];
    const dead =
      !row ||
      row.consumed_at ||
      new Date(row.expires_at) <= new Date() ||
      row.attempts >= MAX_ATTEMPTS;

    if (dead) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    // Already proven — treat a repeat as success rather than burning an
    // attempt. The step-3 screen can be re-submitted by a double click or a
    // back-navigation, and punishing that would lock out a legitimate user.
    if (row.verified_at) {
      return NextResponse.json({ success: true, verified: true });
    }

    if (!digestsEqual(row.code_hash, hashCode(email, code))) {
      // Count the miss BEFORE answering, so a client that abandons the
      // connection still pays for the guess.
      await svc
        .from("email_verifications")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id);

      const left = Math.max(0, MAX_ATTEMPTS - (row.attempts + 1));
      return NextResponse.json(
        {
          error: "Invalid or expired code.",
          // A count is safe to give and is the difference between a user
          // retyping calmly and one hammering until the code dies.
          attemptsRemaining: left,
        },
        { status: 400 }
      );
    }

    // Correct. Mark verified; signup consumes it separately, so that one
    // verification cannot create two organizations.
    const { error: markErr } = await svc
      .from("email_verifications")
      .update({ verified_at: nowIso })
      .eq("id", row.id)
      .is("verified_at", null);

    if (markErr) {
      console.error("[verify-code] mark failed:", markErr.message);
      return NextResponse.json({ error: "Could not verify right now." }, { status: 503 });
    }

    return NextResponse.json({ success: true, verified: true });
  } catch (e) {
    console.error("[verify-code]", e?.message || e);
    return NextResponse.json({ error: "Could not verify right now." }, { status: 503 });
  }
}
