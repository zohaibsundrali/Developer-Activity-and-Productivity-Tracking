/**
 * Timestamps that travelled through a query string.
 *
 * The staff dashboard hands a project to /developer/project-details as query
 * parameters, and three of them are timestamps straight from Postgres:
 * `2026-09-04T17:58:12.123456+00:00`. Interpolated raw into the URL, the `+`
 * of the timezone offset is a query-string SPACE, so `searchParams.get()`
 * returned `…12.123456 00:00` and `new Date()` of that is Invalid Date. The
 * default task plan then had no usable start date, every row said "End date
 * is required", and the plan could not be saved until the developer edited
 * every task by hand. It only hit projects whose `assigned_at` / `created_at`
 * carried an offset — which is all of them.
 *
 * The push site now encodes with URLSearchParams, so new links are correct.
 * This repairs a link that was built the old way (a bookmark, a browser tab
 * left open across the deploy): a lone space before a trailing HH:MM can only
 * have been a `+`.
 */
export function dateFromQuery(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  if (!Number.isNaN(new Date(raw).getTime())) return raw;
  const repaired = raw.replace(/ (\d{2}:\d{2})$/, "+$1");
  return Number.isNaN(new Date(repaired).getTime()) ? null : repaired;
}

/** Build the /developer/project-details link so every value survives the trip. */
export function projectDetailsHref(project) {
  const params = new URLSearchParams();
  const put = (key, value) => {
    if (value === null || value === undefined) return;
    params.set(key, String(value));
  };
  put("id", project.id);
  put("name", project.name || "");
  put("description", project.description || "");
  put("status", project.status);
  put("progress", project.progress);
  put("deadline", project.deadline);
  put("created_at", project.created_at);
  put("file_url", project.file_url || "");
  put("file_name", project.file_name || "");
  put("assigned_at", project.assigned_at || "");
  put("assigned_developer_name", project.assigned_developer_name || "");
  put("assigned_developer_email", project.assigned_developer_email || "");
  return `/developer/project-details?${params.toString()}`;
}

/**
 * The same value as a plain YYYY-MM-DD, which is what the task plan works in.
 *
 * The default plan set each task's start to the raw `assigned_at` — a full
 * timestamp — and its end to addDays() of it, which returns a date only. A
 * date-only string parses as midnight UTC, so an end of "2026-09-04" sat
 * BEFORE a start of "2026-09-04T17:58:12+00:00" and validation refused the
 * plan with "End date cannot be before start date" on every row. Both sides
 * now start from the same calendar day. UTC, to agree with addDays().
 */
export function dateOnlyFromQuery(value) {
  const repaired = dateFromQuery(value);
  if (!repaired) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(repaired)) return repaired;
  return new Date(repaired).toISOString().slice(0, 10);
}
