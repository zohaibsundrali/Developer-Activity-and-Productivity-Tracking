/**
 * Signed session cookie shared by the login route and the middleware.
 *
 * SECURITY (audit finding C5): route protection used to test only that a
 * cookie NAMED `admin_auth` existed, and that cookie was written by the browser
 * via `document.cookie` — so `document.cookie="admin_auth=true"` opened the
 * admin console. `HttpOnly` in those strings was inert, because browsers ignore
 * that flag for cookies set from JavaScript.
 *
 * The Supabase session itself lives in sessionStorage, which middleware cannot
 * read, so middleware cannot verify the Supabase JWT directly. Instead the
 * server verifies the JWT once at login and issues its own short-lived HMAC
 * signed cookie carrying { userType, role, orgId, exp }. Middleware verifies
 * that signature on every protected navigation.
 *
 * Uses Web Crypto so the same code runs in the Edge middleware runtime and in
 * Node route handlers.
 */

export const SESSION_COOKIE = "dt_session";

// 12 hours, matching the existing cookie lifetime used at login.
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function secretMaterial() {
  // No new environment variable is required: the service-role key is present in
  // every working deployment and never reaches the browser. A dedicated
  // SESSION_COOKIE_SECRET takes precedence when set.
  return (
    process.env.SESSION_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function b64url(bytes) {
  let binary = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToString(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  return atob(padded + pad);
}

async function hmac(payloadB64) {
  const secret = secretMaterial();
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return b64url(sig);
}

/** Build a signed cookie value for a verified session. */
export async function signSession({ userType, role, orgId }) {
  const payload = {
    t: userType || null,
    r: role || null,
    o: orgId || null,
    e: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(payloadB64);
  if (!sig) return null;
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a cookie value. Returns { userType, role, orgId } or null when the
 * signature is wrong, the value is malformed, or the session has expired.
 */
export async function verifySession(value) {
  if (!value || typeof value !== "string") return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;

  const payloadB64 = value.slice(0, dot);
  const provided = value.slice(dot + 1);

  const expected = await hmac(payloadB64);
  if (!expected) return null;

  // Length-independent comparison.
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64));
  } catch {
    return null;
  }
  if (!payload?.e || payload.e < Math.floor(Date.now() / 1000)) return null;

  return { userType: payload.t, role: payload.r, orgId: payload.o };
}
