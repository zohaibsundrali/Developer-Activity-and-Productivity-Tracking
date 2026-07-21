import { supabase } from "@/utils/supabaseClient";

// Task-submission files live in a PRIVATE Supabase Storage bucket, so their
// stored public URLs do not resolve. Always mint a short-lived signed URL
// on demand (the anon key is permitted to sign this bucket via storage policy).
const BUCKET = "task-submissions";

/**
 * Derive the bucket-relative object path from a stored file URL when an explicit
 * storage_path is not available (older rows may only have the public file_url).
 */
export function submissionPathFromUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  const marker = `/${BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  const raw = fileUrl.slice(idx + marker.length).split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Create a fresh, short-lived signed URL for a private task-submission file.
 * Prefers storagePath; falls back to deriving the path from a stored file_url.
 * Returns null if no path can be resolved or signing fails.
 */
export async function getSignedSubmissionUrl({ storagePath, fileUrl, expiresIn = 300 } = {}) {
  const path = storagePath || submissionPathFromUrl(fileUrl);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      if (error) console.error("Failed to sign task-submission file:", error.message);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.error("Failed to sign task-submission file:", e);
    return null;
  }
}
