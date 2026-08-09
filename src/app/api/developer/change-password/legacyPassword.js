/**
 * Hashing and verification for the LEGACY password columns
 * (developers.password, admin_users.password, clients.password).
 *
 * WHAT THESE COLUMNS ARE
 *  They are a leftover from the pre-Supabase-Auth login. Migration 012 created
 *  a real Supabase Auth user for every existing profile row, and Supabase Auth
 *  has been the authoritative credential ever since.
 *
 * NOTHING IN THE APPLICATION VERIFIES AGAINST THEM ANY MORE
 *  The last reader was the fallback branch in src/app/login/page.js, and it has
 *  been deleted: it ran only after Supabase Auth sign-in had failed, at which
 *  point the browser is still the `anon` role, and every policy on developers /
 *  admin_users / clients is `TO authenticated` (013, 014; 018 and 040 add none).
 *  Its profile lookup returned zero rows, so the comparison was unreachable.
 *  No writer creates a new value either — signup, invitation-accept and the
 *  admin "add developer" flow all stopped writing the column, and
 *  /api/developer/change-password stopped re-syncing it.
 *
 *  What remains in those columns is the historical values: rows written before
 *  that change, most of them still cleartext. GET /api/admin/legacy-auth-audit
 *  counts them (it imports LEGACY_HASH_PREFIX from here to tell the two shapes
 *  apart, which is the only remaining import of this module in src/).
 *
 * WHY THE HASH/VERIFY PAIR IS KEPT
 *  Stage 5 of database/041_password_hardening.sql is a one-off service-role
 *  pass that replaces each surviving cleartext value with a PBKDF2 hash of
 *  itself — pgcrypto cannot produce this format, so it has to be done in JS.
 *  hashLegacyPassword() is what that script derives with, and
 *  verifyLegacyPassword() is how the result is checked. Both are exercised by
 *  tests/changePassword.test.js. Neither is on any request path.
 *
 * WHY VERIFY ACCEPTS BOTH SHAPES
 *  A stored value may be a hash or an untouched cleartext row, and a checker
 *  that only understood one of them would silently report the other as a
 *  mismatch. The cleartext branch goes away once stage 5 has run.
 *
 * WHY PBKDF2 AND NOT BCRYPT
 *  It had to run in the browser as well as in Node when the login page still
 *  verified against these columns. PBKDF2 via Web Crypto is in Node 20 and every
 *  supported browser with no dependency at all, so nothing was added to
 *  package.json and there was never a second implementation to keep in sync.
 *  That constraint is gone, but so is any reason to change the format: the
 *  hashes already written by /api/developer/change-password are in it.
 *  Parameters follow the OWASP recommendation for PBKDF2-HMAC-SHA256
 *  (210,000 iterations).
 *
 * LOCATION
 *  This belongs in src/utils/. It lives here for historical reasons — the change
 *  that introduced it was fenced to src/app/api/developer/change-password/**.
 *  Its one importer in src/ is now src/app/api/admin/legacy-auth-audit/route.js,
 *  so moving it is a rename plus one import.
 */

export const LEGACY_HASH_SCHEME = "pbkdf2";
export const LEGACY_HASH_PREFIX = "pbkdf2$";

const DIGEST = "sha256";
const ITERATIONS = 210000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

// Guard rails for a stored iteration count, so a tampered or corrupted row
// cannot turn a verification into a denial-of-service.
const MIN_ITERATIONS = 1000;
const MAX_ITERATIONS = 5000000;

const encoder = new TextEncoder();

function webcrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error("Web Crypto is unavailable, so legacy passwords cannot be hashed.");
  }
  return c;
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(password, salt, iterations) {
  const { subtle } = webcrypto();
  const key = await subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

/** Length-independent comparison of two byte arrays. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Comparison for the cleartext rows that have not been rewritten yet. Not
 * meaningfully constant-time in JavaScript, but it does not short-circuit on
 * the first differing character the way `===` does.
 */
function equalStrings(a, b) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** True if a stored value is one of the hashes this module writes. */
export function isLegacyHash(stored) {
  return typeof stored === "string" && stored.startsWith(LEGACY_HASH_PREFIX);
}

/**
 * Hash a password for storage in a legacy column.
 * Format: pbkdf2$sha256$<iterations>$<salt-b64>$<derived-key-b64>
 */
export async function hashLegacyPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("A legacy password hash requires a non-empty password.");
  }
  const salt = new Uint8Array(SALT_BYTES);
  webcrypto().getRandomValues(salt);
  const derived = await deriveBits(password, salt, ITERATIONS);
  return [
    LEGACY_HASH_SCHEME,
    DIGEST,
    String(ITERATIONS),
    toBase64(salt),
    toBase64(derived),
  ].join("$");
}

/**
 * Verify an input against a stored legacy value, which may be either a hash
 * written by hashLegacyPassword() or an untouched cleartext row.
 *
 * Returns false — never throws — for every malformed / empty / absent stored
 * value, so a bad row is a failed login and not a 500.
 */
export async function verifyLegacyPassword(input, stored) {
  if (typeof input !== "string" || input.length === 0) return false;
  if (typeof stored !== "string" || stored.length === 0) return false;

  if (!isLegacyHash(stored)) return equalStrings(stored, input);

  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  const [, digest, iterationText, saltText, hashText] = parts;
  if (digest !== DIGEST) return false;

  const iterations = Number.parseInt(iterationText, 10);
  if (!Number.isInteger(iterations)) return false;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return false;

  let salt;
  let expected;
  try {
    salt = fromBase64(saltText);
    expected = fromBase64(hashText);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await deriveBits(input, salt, iterations);
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}
