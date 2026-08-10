import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { sendEmail } from "@/utils/emailService";
import { renderTemplate } from "@/utils/emailTemplates";
import { RESET_PASSWORD_PATH, resolveAppOrigin } from "@/components/auth/resetRedirect";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot-password — send a password-reset link from US.
 *
 * WHAT THIS REPLACES, AND WHY
 *  /forgot-password called `supabase.auth.resetPasswordForEmail()` in the
 *  browser. That works, but it makes SUPABASE send the email: Supabase's
 *  default template, Supabase's sender, Supabase's wording. What lands in the
 *  inbox names a service the recipient has never heard of, about an account
 *  they hold with us. On the one message in the product where looking
 *  trustworthy matters most, it reads like phishing.
 *
 *  This route keeps Supabase's token and takes over the envelope:
 *
 *    auth.admin.generateLink({ type: "recovery" })
 *      mints exactly the same single-use recovery link resetPasswordForEmail
 *      would have mailed — and does NOT send anything.
 *
 *  So there is still no reset table, no code of our own, and no second notion
 *  of "valid link". The token, its single-use property and its expiry are all
 *  Supabase's, unchanged. Only the delivery is ours, which is what routes it
 *  through the branded template, the configured From address, the retries and
 *  the email_log row every other message in the product already gets.
 *
 * WHY IT IS A SERVER ROUTE
 *  `generateLink` is an admin call. It needs the service-role key, which must
 *  never reach a browser. That is also why the reply below carries nothing
 *  derived from the lookup: not the link, not the user id, not whether the
 *  address matched anything.
 *
 * ACCOUNT ENUMERATION
 *  The response is byte-for-byte identical whether or not the address has an
 *  account: same status, same body, and no timing branch worth measuring. A
 *  "no account with that email" reply would turn this endpoint into an oracle
 *  that confirms membership for any address an attacker can guess, which for a
 *  workplace-monitoring product leaks who works where. The only errors it
 *  reports are about the REQUEST — a malformed address, or the rate limit.
 *
 * THE REDIRECT TARGET IS NEVER TAKEN FROM THE REQUEST BODY.
 *  It is built here from NEXT_PUBLIC_APP_URL, falling back to the origin this
 *  route was actually served on. A caller-supplied `redirectTo` would let
 *  someone mail a victim a genuine-looking reset link that lands on a host they
 *  control. Supabase's own redirect allow-list is the enforcement; refusing to
 *  read the value is what stops us asking for the wrong thing in the first
 *  place. See src/components/auth/resetRedirect.js.
 */

// Supabase's default recovery-link lifetime is one hour. This is COPY — the
// email states it, the expiry is enforced by Supabase, and nothing here can
// change it. If the project's "Email OTP Expiration" is retuned in the Supabase
// dashboard, change this to match so the message stops lying.
const LINK_TTL_MINUTES = 60;

// Same shape as the limiter in src/app/api/send-verification/route.js: best
// effort, per-process. Serverless instances each keep their own counter, so
// this caps abuse rather than eliminating it. Supabase applies its own limit to
// generateLink underneath, which is the harder ceiling.
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const bucket = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  bucket.push(now);
  hits.set(key, bucket);
  if (hits.size > 5000) hits.clear(); // crude memory bound
  return bucket.length > MAX_PER_WINDOW;
}

/** The one reply this route ever gives on the happy path. */
function accepted() {
  return NextResponse.json({
    ok: true,
    message:
      "If an account exists for that address, a link to set a new password is on its way.",
  });
}

export async function POST(request) {
  let email = "";

  try {
    const body = await request.json().catch(() => ({}));
    const raw = typeof body.email === "string" ? body.email.trim() : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.length > 254) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 }
      );
    }
    email = raw;

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (rateLimited(`ip:${ip}`) || rateLimited(`to:${email.toLowerCase()}`)) {
      return NextResponse.json(
        { error: "Too many reset requests. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    // No service key means `generateLink` is not available at all. Rather than
    // leave the flow dead, fall through to Supabase's own send below — an email
    // that looks wrong is better than no way back into the account.
    if (!serviceKey || !supabaseUrl) {
      console.error("[forgot-password] service role key missing — falling back to Supabase delivery");
      await supabaseFallback(request, email);
      return accepted();
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const redirectTo = `${appOrigin(request)}${RESET_PASSWORD_PATH}`;

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    // The overwhelmingly common cause is "no such user", which is exactly the
    // case we must not disclose. Log it server-side, answer as if we had sent.
    if (error || !data?.properties?.action_link) {
      console.warn("[forgot-password] no recovery link minted:", error?.message || "no action_link");
      return accepted();
    }

    const actionLink = data.properties.action_link;

    // The name, when Auth happens to carry one. Never fetched from a profile
    // table: a lookup that hits the database only for real accounts is the same
    // enumeration oracle by another route, just measured in milliseconds.
    const userName =
      data.user?.user_metadata?.full_name ||
      data.user?.user_metadata?.name ||
      "";

    const { subject, html, text } = renderTemplate("password_reset", {
      userName,
      email,
      resetUrl: actionLink,
      expiresInMinutes: LINK_TTL_MINUTES,
    });

    const result = await sendEmail({
      to: email,
      subject,
      html,
      text,
      template: "password_reset",
    });

    // `delivered` is false in mock mode even though `ok` is true — see the note
    // on the return shape in src/utils/emailService.js. Either way the person
    // asked for a link and no link left the building, so hand the job back to
    // Supabase, which has its own transport.
    if (!result.ok || !result.delivered) {
      console.error(
        "[forgot-password] branded send did not deliver (mode=%s, ok=%s) — falling back to Supabase delivery",
        result.mode,
        result.ok
      );
      await supabaseFallback(request, email);
    }

    return accepted();
  } catch (e) {
    // Never surfaces the reason. A transport error from an SMTP client will
    // happily quote the credential it just tried inside its own message.
    console.error("[forgot-password] unexpected failure:", e?.message || e);
    return accepted();
  }
}

/** The deployment's own origin — env first, then the origin we were served on. */
function appOrigin(request) {
  let requestOrigin = "";
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    /* malformed request URL — the env var, or the relative path, will do */
  }
  return resolveAppOrigin(process.env.NEXT_PUBLIC_APP_URL, requestOrigin);
}

/**
 * Last resort: let Supabase send its own (unbranded) recovery email.
 *
 * Uses the ANON key, not the service role — this is the same public primitive
 * the browser used to call, and running it with elevated credentials would gain
 * nothing. It is deliberately quiet: a failure here is already the second
 * failure in a row, and the caller has been told "if an account exists…"
 * regardless.
 */
async function supabaseFallback(request, email) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;

    const client = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${appOrigin(request)}${RESET_PASSWORD_PATH}`,
    });
  } catch (e) {
    console.error("[forgot-password] Supabase fallback also failed:", e?.message || e);
  }
}
