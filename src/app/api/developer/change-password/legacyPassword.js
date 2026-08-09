/**
 * Hashing and verification for the LEGACY password columns
 * (developers.password, admin_users.password, clients.password).
 *
 * WHAT THESE COLUMNS ARE
 *  They are a leftover from the pre-Supabase-Auth login. Migration 012 created
 *  a real Supabase Auth user for every existing profile row, and Supabase Auth
 *  has been the authoritative credential ever since. The columns survive only
 *  to feed the legacy fallback branch in src/app/login/page.js.
 *
 * WHY THE VALUES ARE HASHED FROM NOW ON
 *  Migrations 013/014 put an `org_isolation`-style RLS policy on all three
 *  tables: `for all TO AUTHENTICATED using (organization_id = auth_org())`.
 *  That means every logged-in member of an organization can `select *` from
 *  developers / admin_users / clients and read every colleague's password in
 *  cleartext through PostgREST. Storing a one-way hash instead removes the
 *  usable credential from that read without removing the column, so the
 *  fallback keeps working while the exposure goes away for every row we touch.
 *
 * WHY BOTH SHAPES ARE ACCEPTED ON READ
 *  Rows written before this change hold cleartext, and several writers this
 *  change is not allowed to touch (auth/signup, invitations/accept,
 *  admin/registration, AddDeveloper, ClientManagement) still insert cleartext.
 *  verifyLegacyPassword() therefore accepts a stored hash OR a stored
 *  cleartext value, so no existing row stops working. The cleartext branch is
 *  deleted in stage 3 of the plan in database/041_password_hardening.sql.
 *
 * WHY PBKDF2 AND NOT BCRYPT
 *  This module has to run in BOTH places that verify a legacy password: the
 *  Node route handler and the browser login page. PBKDF2 via Web Crypto is in
 *  Node 20 and every supported browser with no dependency at all, so nothing is
 *  added to package.json and nothing has to be kept in sync between two
 *  implementations. Parameters follow the OWASP recommendation for
 *  PBKDF2-HMAC-SHA256 (210,000 iterations).
 *
 * LOCATION
 *  This belongs in src/utils/. It lives here because this change is scoped to
 *  src/app/api/developer/change-password/**; move it when that fence is lifted.
 *  It imports nothing server-only, so it is safe in the client bundle.
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
