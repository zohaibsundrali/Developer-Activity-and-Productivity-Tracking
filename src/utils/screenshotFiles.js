import { supabase } from "@/utils/supabaseClient";

/**
 * Screenshot URL resolution (audit finding H2 / Phase 2).
 *
 * Monitoring screenshots are the most sensitive artefact this product stores —
 * they are literal captures of an employee's screen. They used to be written to
 * the PUBLIC `documents` bucket and rendered straight from `public_url`, so
 * anyone holding (or guessing) the URL could view them with no session at all.
 *
 * New uploads go to the PRIVATE `monitoring` bucket (see migration 019) and are
 * rendered through short-lived signed URLs. A storage policy restricts signing
 * to members of the owning organization, so the org id in the path is enforced
 * by the database, not by this module.
 *
 * BACKWARD COMPATIBILITY: rows written before this change still live in the
 * public bucket and only have `public_url`. Those keep rendering from the
 * stored URL — nothing breaks — but they stay publicly reachable until the
 * objects are migrated. `legacyPublicScreenshotCount()` reports how many are
 * left so the cleanup can be tracked.
 */

export const SCREENSHOT_BUCKET = "monitoring";

// Signed URLs are short-lived: long enough to render a gallery and open a
// lightbox, short enough that a leaked URL expires quickly.
const DEFAULT_EXPIRY_SECONDS = 600;

/**
 * True when the row points at the private bucket (i.e. it was written after the
 * Phase 2 change) and therefore needs signing.
 */
export function isPrivateScreenshot(row) {
  const path = row?.storage_path;
  return Boolean(path) && !String(path).startsWith("screenshots/");
}

/**
 * Resolve one screenshot row to a URL that an <img> can render.
 * Returns the row's legacy public URL when it predates the private bucket.
 */
export async function resolveScreenshotUrl(row, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  const legacyUrl = row?.public_url || row?.image_url || row?.thumbnail_url || null;
  if (!isPrivateScreenshot(row)) return legacyUrl;

  try {
    const { data, error } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .createSignedUrl(row.storage_path, expiresIn);
    if (error || !data?.signedUrl) return legacyUrl;
    return data.signedUrl;
  } catch {
    return legacyUrl;
  }
}

/**
 * Batch version — signs every private row in one round trip per bucket and
 * leaves legacy rows untouched. Returns rows with `public_url` set to something
 * renderable, so existing consumers keep working unchanged.
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

  return list.map((r) => {
    const legacyUrl = r?.public_url || r?.image_url || r?.thumbnail_url || null;
    return {
      ...r,
      public_url: signedByPath.get(r?.storage_path) || legacyUrl,
    };
  });
}

/**
 * How many screenshots still live in the public bucket. Used to track the
 * one-off object migration; returns null if the count cannot be read.
 */
export async function legacyPublicScreenshotCount() {
  try {
    const { count, error } = await supabase
      .from("screenshots")
      .select("id", { count: "exact", head: true })
      .like("storage_path", "screenshots/%");
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}
