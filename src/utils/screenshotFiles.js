import { supabase } from "@/utils/supabaseClient";

/**
 * Screenshot URL resolution (audit finding H2 / Phase 2).
 *
 * Monitoring screenshots are the most sensitive artefact this product stores —
 * they are literal captures of an employee's screen.
 *
 * New uploads go to the PRIVATE `monitoring` bucket (see migration 019) under
 * `{organization_id}/{developer_id}/{file}` and are rendered through
 * short-lived signed URLs. Migration 040 replaced 019's org-wide read policy
 * with a per-person one that reads the SECOND path segment as the developer id,
 * so the path shape is what enforces access — see `isMonitoringPath` below.
 *
 * ─── WHY THE CLASSIFIER LOOKS THE WAY IT DOES ───────────────────────────────
 *
 * This module used to decide "does this row need signing?" with
 *
 *     !String(row.storage_path).startsWith("screenshots/")
 *
 * That predicate was written for the world 019 described, where the legacy
 * captures sat inside the public `documents` bucket under a `screenshots/`
 * prefix. That is not where they actually are. The live project has a SEPARATE
 * PUBLIC BUCKET literally named `screenshots`, and its objects are keyed
 * `{email_local_part}/{file}.jpg` — no `screenshots/` prefix anywhere in the
 * stored path.
 *
 * So the old predicate matched nothing: every legacy row was classified as
 * private, signed against `monitoring` (where the object does not exist), the
 * signing failed, and the catch/fallback quietly served `public_url` instead.
 * The images rendered, so nothing looked broken — but they rendered from a
 * world-readable URL, and 019's own progress tracker
 * (`storage_path like 'screenshots/%'`) reported zero rows left to migrate the
 * entire time.
 *
 * The classifier is therefore POSITIVE now: a row is treated as private only
 * when its path actually has the `monitoring` shape that migration 040's policy
 * can read. Anything else is legacy-until-proven-otherwise. Signing is the
 * default; the public URL is an explicit, dated fallback.
 */

export const SCREENSHOT_BUCKET = "monitoring";

/**
 * The public bucket the pre-019 desktop agent wrote to, and still writes to.
 * Named here only so the fallback below and scripts/migrate-screenshots.mjs
 * talk about the same thing. Nothing in this module ever writes to it.
 */
export const LEGACY_PUBLIC_BUCKET = "screenshots";

// Signed URLs are short-lived: long enough to render a gallery and open a
// lightbox, short enough that a leaked URL expires quickly.
const DEFAULT_EXPIRY_SECONDS = 600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The organization segment the upload route substitutes when a developer row
 * carries no organization_id. Such an object is deliberately unreachable under
 * migration 040's policy — `(storage.foldername(name))[1] = auth_org()::text`
 * can never match the literal string — which is the correct fail-closed
 * outcome: an unattributable capture is visible to the service role only.
 */
export const UNASSIGNED_ORG_SEGMENT = "unassigned";

/**
 * Does this key have the shape migration 040's storage policy can read?
 *
 *     {organization_id}/{developer_id}/{anything}
 *
 * Segment 1 must be an organization uuid (or the `unassigned` sentinel) because
 * the policy compares it against `auth_org()`. Segment 2 must be a developer
 * uuid because the policy feeds it to `public.try_uuid()` and then to
 * `auth_can_read_member()`; a non-uuid there resolves to null and the object
 * becomes owner/admin-only. A key that fails this test is not governed by
 * migration 040 at all, so signing it against `monitoring` cannot succeed.
 */
export function isMonitoringPath(path) {
  if (!path || typeof path !== "string") return false;
  const parts = path.split("/");
  if (parts.length < 3) return false;
  const [org, developer, ...rest] = parts;
  if (org !== UNASSIGNED_ORG_SEGMENT && !UUID_RE.test(org)) return false;
  if (!UUID_RE.test(developer)) return false;
  return rest.every((segment) => segment.length > 0);
}

/**
 * Build the key an object must live under to be governed by migration 040.
 * The upload route in src/app/api/upload-screenshot/route.js constructs the
 * same shape inline, and scripts/migrate-screenshots.mjs re-declares it (it is
 * a standalone node script and cannot import through the `@/` alias). All three
 * must agree; the test in tests/screenshotPaths.test.js asserts they do.
 */
export function buildMonitoringPath({ organizationId, developerId, filename }) {
  if (!developerId) throw new Error("developerId is required to build a monitoring path");
  if (!filename) throw new Error("filename is required to build a monitoring path");
  const org = organizationId || UNASSIGNED_ORG_SEGMENT;
  return `${org}/${developerId}/${filename}`;
}

/**
 * True when the row points at an object in the private `monitoring` bucket and
 * therefore needs signing.
 */
export function isPrivateScreenshot(row) {
  return isMonitoringPath(row?.storage_path);
}

/**
 * The stored, world-readable URL for a row that has not been migrated yet.
 *
 * ─── FALLBACK: REMOVE WHEN THE `screenshots` BUCKET IS GONE ─────────────────
 * This exists only so that screen captures still sitting in the public
 * `screenshots` bucket keep rendering while the migration runs. It is safe to
 * delete this function, and every call to it, once BOTH are true:
 *
 *   1. scripts/migrate-screenshots.mjs reports 0 rows left to migrate
 *      (equivalently: `legacyPublicScreenshotCount()` returns 0), AND
 *   2. the owner has flipped the `screenshots` bucket to private, after which
 *      these URLs return 400 and the fallback is worse than useless.
 *
 * Until then it is load-bearing. See docs/screenshot-bucket-migration.md.
 */
function legacyPublicUrl(row) {
  return row?.public_url || row?.image_url || row?.thumbnail_url || null;
}

/**
 * Resolve one screenshot row to a URL that an <img> can render.
 *
 * A signed URL is always preferred. The legacy public URL is returned only when
 * the row is not a `monitoring` object, or when signing one genuinely fails.
 */
export async function resolveScreenshotUrl(row, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  if (!isPrivateScreenshot(row)) return legacyPublicUrl(row);

  try {
    const { data, error } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .createSignedUrl(row.storage_path, expiresIn);
    if (error || !data?.signedUrl) return legacyPublicUrl(row);
    return data.signedUrl;
  } catch {
    return legacyPublicUrl(row);
  }
}

/**
 * Batch version — signs every private row in one round trip and leaves legacy
 * rows untouched. Returns rows with `public_url` set to something renderable,
 * so existing consumers keep working unchanged.
 *
 * Note that a migrated row has its `public_url` nulled by the migration script,
 * so if signing fails for such a row this returns null rather than a public
 * URL. That is deliberate: after migration there is no public URL to fall back
 * to, and inventing one would defeat the exercise.
 */
export async function resolveScreenshotUrls(rows, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const privateRows = list.filter(isPrivateScreenshot);
  const signedByPath = new Map();

  if (privateRows.length) {
    try {
      const paths = [...new Set(privateRows.map((r) => r.storage_path))];
      const { data, error } = await supabase.storage
        .from(SCREENSHOT_BUCKET)
        .createSignedUrls(paths, expiresIn);
      if (!error && Array.isArray(data)) {
        for (const entry of data) {
          if (entry?.path && entry?.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
        }
      }
    } catch {
      // Fall through: rows keep their legacy URL (or render as unavailable).
    }
  }

  return list.map((r) => ({
    ...r,
    public_url: signedByPath.get(r?.storage_path) || legacyPublicUrl(r),
  }));
}

/**
 * How many screenshot rows still point outside the private `monitoring` bucket.
 * Used to track the one-off object migration; returns null if it cannot be read.
 *
 * Counted as "total minus monitoring-shaped", because PostgREST cannot express
 * the negation of the shape test directly. The `_` wildcards spell out a uuid;
 * `*` is PostgREST's `%`. This deliberately replaces the old
 * `like 'screenshots/%'` filter, which matched none of the 88 rows actually
 * sitting in the public bucket and so reported the cleanup as already finished.
 */
export async function legacyPublicScreenshotCount() {
  const UUID_LIKE = "________-____-____-____-____________";
  try {
    const total = await supabase.from("screenshots").select("id", { count: "exact", head: true });
    if (total.error) return null;

    const migrated = await supabase
      .from("screenshots")
      .select("id", { count: "exact", head: true })
      .or(`storage_path.like.${UUID_LIKE}/*,storage_path.like.${UNASSIGNED_ORG_SEGMENT}/*`);
    if (migrated.error) return null;

    return Math.max(0, (total.count ?? 0) - (migrated.count ?? 0));
  } catch {
    return null;
  }
}
