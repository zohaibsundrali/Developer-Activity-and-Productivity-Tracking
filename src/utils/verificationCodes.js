import crypto from "crypto";

/**
 * Signup verification codes — the shared vocabulary for the three server
 * routes that touch them (`/api/send-verification`, `/api/auth/verify-code`,
 * `/api/auth/signup`).
 *
 * It lives in one module because the three have to agree exactly on how an
 * address is normalised and how a code is hashed. If `send` normalises
 * differently from `verify`, the lookup silently misses and every legitimate
 * code appears wrong; if `verify` hashes differently from `send`, the same.
 * Neither failure looks like a bug from the outside — it looks like the user
 * typing the wrong number.
 *
 * See database/056_email_verification.sql for the table and its RLS model.
 */

/** Codes last ten minutes. The email says so, and now that is enforced. */
export const CODE_TTL_MINUTES = 10;

/**
 * How many wrong guesses one issued code tolerates before it is dead.
 *
 * A 4-digit code is one of 10,000. Without a cap, walking the whole space is
 * a few seconds of scripted requests, and the per-IP rate limit on the SEND
 * route does not help because guessing does not send anything. Five attempts
 * puts the odds of blind success at 1 in 2,000 per issued code.
 */
export const MAX_ATTEMPTS = 5;

/**
 * A completed verification is good for this long. Long enough to finish
 * choosing a plan and typing card details, short enough that a verification
 * cannot be banked and reused days later.
 */
export const VERIFIED_WINDOW_MINUTES = 60;

/** lower + trim. The one definition; 052 matches on lower(btrim(email)) too. */
export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * A 6-digit code from a CRYPTOGRAPHIC source.
 *
 * Six digits, not the four the browser used to generate: with the attempt cap
 * below, four digits is defensible, but six costs the user nothing and takes
 * blind guessing from 1-in-2,000 to 1-in-200,000 per code.
 *
 * `randomInt` rather than `Math.random()`: the old code came from
 * `Math.floor(1000 + Math.random() * 9000)` in the browser, which is neither
 * unpredictable nor secret — but the reason that was broken was that it lived
 * in the browser at all. Now that the value never leaves the server except by
 * email, it may as well be drawn from a source that is not predictable from
 * previous outputs.
 */
export function newCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * SHA-256 over `email:code`, with an optional pepper from the environment.
 *
 * This is deliberately NOT a password hash, and the reason is worth stating so
 * nobody "fixes" it later: the input space is a million six-digit numbers, so
 * no work factor makes the digest meaningfully hard to reverse. bcrypt here
 * would buy nothing and cost a slow call on every verify.
 *
 * What the hash actually buys is that a leaked copy of the table — a backup, a
 * support export — does not hand out codes that are still live. Binding the
 * email into the digest means one row's hash cannot be replayed against a
 * different address. The real defences are elsewhere and are the ones that
 * matter: the table admits no browser role at all (056 PART 2), codes expire
 * in ten minutes, and MAX_ATTEMPTS kills a row long before the space is walked.
 */
export function hashCode(email, code) {
  const pepper = process.env.VERIFICATION_CODE_PEPPER || "";
  return crypto
    .createHash("sha256")
    .update(`${normalizeEmail(email)}:${String(code)}:${pepper}`)
    .digest("hex");
}

/**
 * Constant-time compare of two hex digests.
 *
 * `a === b` on a digest leaks, through timing, how many leading characters
 * matched. That is a thin channel here — the attacker would have to be
 * measuring a remote handler — but the correct comparison is one line and
 * there is no reason to write the incorrect one.
 */
export function digestsEqual(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
