import { supabase } from "@/utils/supabaseClient";

/**
 * Tenant-isolated file storage (audit finding H2 / Phase 2).
 *
 * The shared `documents` bucket is PUBLIC. Anything written there is readable
 * by anyone holding the URL, with no session and no organization check — and
 * project documents were written to the bucket root with no org prefix at all,
 * so one tenant's files sat beside another's.
 *
 * Sensitive uploads now go to the PRIVATE `org-files` bucket under
 * `{organization_id}/{category}/...`. The storage policies in migration 020
 * read that leading folder, so tenant isolation is enforced by the database
 * rather than by callers remembering to pass the right prefix.
 *
 * Organization logos deliberately stay in the public bucket: they are branding,
 * they are embedded in outbound email, and a signed URL would break there.
 *
 * BACKWARD COMPATIBILITY: columns such as `employee_profiles.photo_url` and
 * `projects.file_url` previously held a full public URL and now hold a storage
 * path. `resolveOrgFileUrl` accepts either — anything starting with http is
 * returned untouched, so rows written before this change keep working.
 */

export const ORG_FILES_BUCKET = "org-files";

const DEFAULT_EXPIRY_SECONDS = 600;

/** A stored value is legacy when it is already a full URL. */
export function isLegacyFileUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function sanitize(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9.\-]/g, "_");
}

/**
 * Upload into the private bucket under the caller's organization.
 * Returns the storage path — callers persist this, not a URL.
 */
export async function uploadOrgFile({ orgId, category, file, subPath = "" }) {
  if (!orgId) throw new Error("Missing organization id for upload.");
  if (!file) throw new Error("No file supplied.");

  const middle = subPath ? `${subPath}/` : "";
  const path = `${orgId}/${category}/${middle}${Date.now()}_${sanitize(file.name)}`;

  const { error } = await supabase.storage
    .from(ORG_FILES_BUCKET)
    .upload(path, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
    });
  if (error) throw error;

  return path;
}

/**
 * Turn a stored value into something renderable or openable.
 * Legacy public URLs pass through; storage paths are signed on demand.
 */
export async function resolveOrgFileUrl(value, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  if (!value) return null;
  if (isLegacyFileUrl(value)) return value;

  try {
    const { data, error } = await supabase.storage
      .from(ORG_FILES_BUCKET)
      .createSignedUrl(value, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Batch variant — one round trip for every path that needs signing.
 * Returns a Map keyed by the original stored value.
 */
export async function resolveOrgFileUrls(values, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  const resolved = new Map();
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (!list.length) return resolved;

  const paths = [];
  for (const v of list) {
    if (isLegacyFileUrl(v)) resolved.set(v, v);
    else if (!paths.includes(v)) paths.push(v);
  }
  if (!paths.length) return resolved;

  try {
    const { data, error } = await supabase.storage
      .from(ORG_FILES_BUCKET)
      .createSignedUrls(paths, expiresIn);
    if (!error && Array.isArray(data)) {
      for (const entry of data) {
        if (entry?.path && entry?.signedUrl) resolved.set(entry.path, entry.signedUrl);
      }
    }
  } catch {
    // Unresolved paths simply stay absent from the map.
  }
  return resolved;
}
