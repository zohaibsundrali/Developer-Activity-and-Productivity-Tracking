/**
 * A per-process rate limiter.
 *
 * WHY THIS FILE EXISTS. The same fifteen lines were written twice — in
 * /api/send-verification and /api/auth/forgot-password — with the same
 * `hits` Map, the same sliding window and the same crude memory bound. A third
 * copy was about to be written for the screenshot ingest, and a fourth for
 * /api/auth/verify-code, which guesses a six-digit code and had no limiter at
 * all. Copies drift; this is the same reason the permission catalogue exists.
 *
 * WHAT IT IS NOT. This is per-process and in-memory. On serverless every
 * instance keeps its own counter, so N instances multiply the effective limit
 * by N. It raises the cost of abuse; it does not make abuse impossible. Where a
 * hard ceiling matters the real control has to be in the database or at the
 * edge, and the call site should say which. Both existing call sites already
 * say so and those comments are kept.
 *
 * The window is SLIDING, not fixed: timestamps older than the window are
 * dropped on each call rather than the whole bucket being reset on a boundary,
 * so an attacker cannot get 2x the limit by straddling one.
 */

const buckets = new Map();

// Crude memory bound. An unbounded Map keyed by attacker-supplied values is
// itself a denial-of-service vector; clearing wholesale is cruder than an LRU
// and cannot leak, which is the property that matters here.
const MAX_KEYS = 5000;

/**
 * Record an attempt and say whether it exceeded the limit.
 *
 * @param {string} key        what is being limited — an IP, an email, an id.
 *                            Namespace it per route ("verify:1.2.3.4"), or two
 *                            routes will share one budget.
 * @param {object} [options]
 * @param {number} [options.max=5]            attempts allowed per window
 * @param {number} [options.windowMs=900000]  window length, default 15 minutes
 * @returns {boolean} true when this attempt is OVER the limit and should be
 *                    refused. The attempt is counted either way, so a caller
 *                    that keeps trying keeps the window open — which is the
 *                    behaviour you want against a script.
 */
export function rateLimited(key, { max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  if (!key) return false;
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > MAX_KEYS) buckets.clear();
  return recent.length > max;
}

/**
 * The caller's IP, as well as it can be known behind a proxy.
 *
 * `x-forwarded-for` is client-settable and Vercel appends rather than replaces,
 * so the FIRST entry is the one the platform saw. It is still spoofable in
 * general — an IP key raises the cost of casual abuse and nothing more. Falls
 * back to a single shared bucket, which is deliberately strict: an unknown
 * origin should not get its own private allowance.
 */
export function clientIp(request) {
  const forwarded = request?.headers?.get?.("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || request?.headers?.get?.("x-real-ip") || "unknown";
}

/** Testing only: forget every recorded attempt. */
export function resetRateLimits() {
  buckets.clear();
}
