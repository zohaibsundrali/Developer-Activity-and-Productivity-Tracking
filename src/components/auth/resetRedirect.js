/**
 * Where Supabase should send someone back to after they click a password-reset
 * email.
 *
 * NOT a "use client" module and deliberately hook-free: it is pure string work,
 * so it can be unit-tested in the node environment without a DOM.
 *
 * THE RULE THIS ENCODES
 *  The redirect target must never be a hardcoded host. A reset link that points
 *  at someone else's deployment is, at best, a broken flow for every preview
 *  build and self-hosted install, and at worst an open redirect baked into an
 *  email nobody can recall. So the origin comes from exactly two places, in
 *  order:
 *
 *   1. NEXT_PUBLIC_APP_URL — the deployment's own configured origin.
 *   2. The origin of the request the user is standing on (window.location.origin).
 *
 *  If neither is available we return a RELATIVE path. Supabase treats that as
 *  "use the Site URL configured on the project", which is the correct fallback:
 *  a wrong absolute host is worse than no host.
 *
 *  Note that this only decides which of the project's own allow-listed
 *  redirect URLs is used. Supabase refuses any redirectTo that is not on that
 *  allow-list, which is the real enforcement — this just stops us asking for
 *  the wrong one.
 */

/** The path the reset email lands on. Single source of truth. */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Strips trailing slashes so we never build `https://host//reset-password`. */
const trimEnd = (value) => String(value || "").replace(/\/+$/, "");

/**
 * Resolve the origin to build absolute app URLs from.
 *
 * @param {string} [configured]  typically process.env.NEXT_PUBLIC_APP_URL
 * @param {string} [requestOrigin] typically window.location.origin
 * @returns {string} an origin with no trailing slash, or "" when unknown
 */
export function resolveAppOrigin(configured, requestOrigin) {
  const fromEnv = trimEnd(configured);
  if (fromEnv) return fromEnv;

  const fromRequest = trimEnd(requestOrigin);
  if (fromRequest) return fromRequest;

  return "";
}

/**
 * The full `redirectTo` handed to supabase.auth.resetPasswordForEmail().
 *
 * @param {string} [configured]     process.env.NEXT_PUBLIC_APP_URL
 * @param {string} [requestOrigin]  window.location.origin
 * @returns {string} absolute URL when an origin is known, else the bare path
 */
export function resetRedirectUrl(configured, requestOrigin) {
  const origin = resolveAppOrigin(configured, requestOrigin);
  return `${origin}${RESET_PASSWORD_PATH}`;
}

/**
 * Browser-side convenience: reads the env var and the live origin itself.
 * `process.env.NEXT_PUBLIC_*` is inlined at build time, so this is safe in a
 * client component.
 */
export function currentResetRedirectUrl() {
  return resetRedirectUrl(
    process.env.NEXT_PUBLIC_APP_URL,
    typeof window !== "undefined" ? window.location.origin : ""
  );
}
