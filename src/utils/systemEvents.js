import { createClient } from "@supabase/supabase-js";

/**
 * Server-side event recorder for the `system_events` table (migration 038).
 *
 * WHAT THIS IS NOT
 *  It is not a replacement for src/utils/logger.js. logger.js reports errors
 *  that happen in a BROWSER — a render that threw, an unhandled rejection, an
 *  error boundary. It cannot see a cron job that failed at 03:00, a Stripe
 *  webhook that threw, or a token that was rejected: none of those have a
 *  browser attached. This module is the other half — the durable, queryable
 *  server-side record that Admin → System Health reads.
 *
 * BEST EFFORT, ALWAYS
 *  A monitoring system that breaks the thing it monitors is worse than no
 *  monitoring. Every failure mode here — missing env, network error, RLS
 *  refusal, malformed row, a caller passing nonsense — resolves to `false`.
 *  recordEvent() never throws, never rejects, and never alters what its caller
 *  returns. It is deliberately called from inside failure paths, which are
 *  exactly the paths that must not acquire a second way to fail.
 *
 * NEVER RECORDS A SECRET
 *  `context` is not stored as given. It is reduced to a fixed allow-list of
 *  scalar keys (CONTEXT_KEYS below); everything else — tokens, passwords,
 *  headers, Stripe payloads, request bodies, nested objects, arrays — is
 *  dropped, not redacted, because a redacted secret is still a secret that made
 *  it into the pipeline. `message` is additionally scrubbed of the credential
 *  shapes that turn up inside error strings.
 *
 * SERVER ONLY
 *  Writing requires the service role. SUPABASE_SERVICE_ROLE_KEY is not a
 *  NEXT_PUBLIC_ var, so it is undefined in a browser bundle, and system_events
 *  has no INSERT policy — a browser could not write this table even if it
 *  tried. So the browser path is an explicit, silent no-op rather than a
 *  guaranteed-failing round trip.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Mirrors the CHECK constraints in migration 038. A value outside these sets
// would be rejected by the database, so it is corrected here instead — a
// mislabelled event is still worth having, a lost one is not.
const SEVERITIES = new Set(["info", "warning", "error", "critical"]);
const SOURCES = new Set(["api", "cron", "automation", "email", "auth", "database"]);

/**
 * The complete set of context keys that may be stored. Adding a key here is a
 * deliberate act: it must be an identifier, a count or a short status — never
 * anything a user typed, anything that authenticates, and nothing that would
 * identify a person beyond an opaque id.
 *
 * Not on this list, on purpose: token, authorization, password, apiKey, secret,
 * signature, email, body, payload, headers, cookie, stack.
 */
const CONTEXT_KEYS = [
  "job",          // which cron job
  "rule",         // automation rule name
  "ruleId",
  "action",       // automation action type / webhook action
  "event",        // trigger event name
  "eventType",    // stripe event type
  "stripeEventId",// stripe's own opaque id — safe, and the only way to reconcile
  "taskId",
  "projectId",
  "userId",       // opaque uuid
  "userType",     // admin | developer | client
  "role",
  "status",       // membership / subscription status
  "statusCode",   // http status
  "route",        // which route failed
  "reason",       // short machine-readable cause, never a free-text body
  "code",         // postgres / stripe error code
  "count",
  "attempt",
  "durationMs",
];

const CONTEXT_KEY_SET = new Set(CONTEXT_KEYS);

// Caps. A monitoring row that is megabytes wide is a denial-of-service against
// the table it is supposed to protect.
const MAX_CONTEXT_KEYS = 12;
const MAX_STRING = 200;
const MAX_MESSAGE = 500;

/**
 * Credential shapes that routinely leak into error MESSAGES (which are
 * developer-authored but frequently interpolate a driver's own text). The
 * allow-list already handles `context`; this is the belt for the free-text
 * field that cannot have one.
 */
const REDACTIONS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{6,}/g, "[redacted-stripe-key]"],
  [/\bwhsec_[A-Za-z0-9]{6,}/g, "[redacted-webhook-secret]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
];

function scrub(text) {
  let out = String(text);
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Reduce an arbitrary context object to storable scalars.
 *
 * Drops (silently, by design):
 *  - every key not in CONTEXT_KEYS
 *  - every non-scalar value: objects, arrays, functions, symbols, Dates
 *  - undefined / NaN / Infinity, which are not representable in JSON anyway
 * Truncates every surviving string to MAX_STRING and the whole object to
 * MAX_CONTEXT_KEYS entries.
 */
export function sanitizeContext(context) {
  const out = {};
  if (!context || typeof context !== "object" || Array.isArray(context)) return out;

  let kept = 0;
  for (const key of Object.keys(context)) {
    if (kept >= MAX_CONTEXT_KEYS) break;
    if (!CONTEXT_KEY_SET.has(key)) continue;

    const value = context[key];
    if (value === null) {
      out[key] = null;
      kept += 1;
    } else if (typeof value === "string") {
      out[key] = scrub(value).slice(0, MAX_STRING);
      kept += 1;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
      kept += 1;
    } else if (typeof value === "boolean") {
      out[key] = value;
      kept += 1;
    }
    // anything else (object, array, function, symbol, bigint, undefined) is dropped
  }
  return out;
}

/** True when this process can actually write events. */
export function eventsEnabled() {
  return typeof window === "undefined" && Boolean(SUPABASE_URL && SERVICE_KEY);
}

/**
 * Record one server-side event. Returns true only if the row was written.
 *
 * @param {object}  args
 * @param {?string} args.orgId     organization the event belongs to, or null for
 *                                 a platform-wide event (visible to nobody
 *                                 through RLS — see migration 038).
 * @param {string}  args.type      dotted event name, e.g. "cron.job_failed"
 * @param {string}  args.severity  info | warning | error | critical
 * @param {string}  args.source    api | cron | automation | email | auth | database
 * @param {string}  args.message   short human-readable summary
 * @param {object}  args.context   free-form; reduced to CONTEXT_KEYS scalars
 */
export async function recordEvent({
  orgId = null,
  type,
  severity = "info",
  source = "api",
  message = "",
  context = {},
} = {}) {
  try {
    // No service role (browser bundle, or an unconfigured deployment) means no
    // write is possible. Returning quietly beats a round trip that must fail.
    if (!eventsEnabled()) return false;
    if (!type) return false;

    const row = {
      organization_id: typeof orgId === "string" && orgId ? orgId : null,
      event_type: String(type).slice(0, 100),
      severity: SEVERITIES.has(severity) ? severity : "info",
      source: SOURCES.has(source) ? source : "api",
      message: scrub(message || "").slice(0, MAX_MESSAGE),
      context: sanitizeContext(context),
    };

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await svc.from("system_events").insert(row);
    // Swallowed on purpose: the caller is already handling a failure, and
    // "monitoring could not write" must not become a second exception thrown
    // through a catch block. It IS surfaced on the console so a broken recorder
    // is visible in the platform logs.
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[systemEvents] could not record event:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn("[systemEvents] recorder failed:", err?.message || err);
    } catch {
      /* ignore */
    }
    return false;
  }
}

const systemEvents = { recordEvent, sanitizeContext, eventsEnabled, CONTEXT_KEYS };

export default systemEvents;
