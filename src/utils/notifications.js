import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";

/**
 * Notification centre data access.
 *
 * This sits on top of the EXISTING `notifications` table and the existing
 * writers — it does not replace them. Seven callers already insert rows with
 * their own `type` values, and migration 029 derives `category` on insert so
 * none of them had to change.
 *
 * Three defects this module exists to fix:
 *
 *  1. The unread badge was derived from the loaded page. An admin with forty
 *     unread notifications saw a badge of ten, and it went UP when they pressed
 *     "load more". `getUnreadCount` is a real count query.
 *  2. "Mark all as read" only marked the rows currently loaded, so anything
 *     past the first page silently stayed unread. `markAllRead` updates by
 *     predicate, not by id list.
 *  3. Nothing was clickable. `notificationHref` resolves a row to the screen
 *     that shows the thing it is about.
 */

// Category metadata. `tone` maps onto the existing semantic classes so the
// dropdown needs no new colour values.
export const CATEGORIES = {
  assignment: { label: "Assigned to you", tone: "info", icon: "UserPlus" },
  status: { label: "Status changed", tone: "info", icon: "ArrowRightLeft" },
  mention: { label: "Mentions", tone: "primary", icon: "AtSign" },
  comment: { label: "Comments", tone: "muted", icon: "MessageSquare" },
  deadline: { label: "Due & overdue", tone: "warning", icon: "Clock" },
  review: { label: "Reviews & approvals", tone: "success", icon: "ClipboardCheck" },
  sprint: { label: "Sprints", tone: "primary", icon: "Rocket" },
  project: { label: "Projects", tone: "info", icon: "FolderKanban" },
  team: { label: "Team & employees", tone: "muted", icon: "Users" },
  automation: { label: "Automation", tone: "muted", icon: "Zap" },
  general: { label: "General", tone: "muted", icon: "Bell" },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export function categoryMeta(category) {
  return CATEGORIES[category] || CATEGORIES.general;
}

/**
 * Where a notification should take you.
 *
 * Falls back through the identifiers the row actually has: several older rows
 * carry only a project id, and some carry nothing at all, so this must never
 * produce a broken link. Returning null means "not clickable".
 */
export function notificationHref(n, { audience = "admin" } = {}) {
  if (!n) return null;
  const adminBase = "/admin/dashboard";

  if (n.task_id) {
    // The board opens the drawer for a task id; the developer surface shows it
    // inside the project it belongs to.
    return audience === "admin"
      ? `${adminBase}?section=board&task=${n.task_id}`
      : `/developer/project-details?task=${n.task_id}`;
  }
  if (n.submission_id) {
    return audience === "admin" ? `${adminBase}?section=task-reviews` : null;
  }
  if (n.project_id) {
    return audience === "admin"
      ? `/admin/project-details/${n.project_id}`
      : `/developer/project-details?project=${n.project_id}`;
  }
  if (n.entity_type === "sprint") return audience === "admin" ? `${adminBase}?section=sprints` : null;
  if (n.entity_type === "employee") return audience === "admin" ? `${adminBase}?section=employees` : null;
  if (n.entity_type === "team") return audience === "admin" ? `${adminBase}?section=team-stats` : null;
  return null;
}

/** The filter that selects "notifications addressed to me". */
function recipientFilter(query, { userId, email, audience }) {
  const clauses = [];
  if (audience === "admin") {
    if (userId) clauses.push(`admin_id.eq.${userId}`);
    if (email) clauses.push(`admin_email.ilike.%${email}%`);
  } else {
    if (userId) clauses.push(`developer_id.eq.${userId}`);
    if (userId) clauses.push(`assigned_developer_id.eq.${userId}`);
  }
  // No identity means no notifications — never fall through to "everything".
  if (!clauses.length) return query.eq("id", "00000000-0000-0000-0000-000000000000");
  return query.or(clauses.join(","));
}

/**
 * A page of notifications, newest first.
 * `category` narrows to one group; omit it for everything.
 */
export async function fetchNotifications({
  userId,
  email,
  audience = "admin",
  category = null,
  unreadOnly = false,
  page = 0,
  pageSize = 15,
} = {}) {
  const orgId = getOrgId();
  const from = page * pageSize;

  let query = supabase
    .from("notifications")
    .select("id, title, message, type, category, read, read_at, created_at, task_id, project_id, submission_id, entity_type, entity_id, actor_id")
    .order("created_at", { ascending: false })
    // created_at ties would otherwise let a row appear on two pages or none.
    .order("id", { ascending: false })
    .range(from, from + pageSize); // one extra row is the has-more probe

  if (orgId) query = query.eq("organization_id", orgId);
  if (category) query = query.eq("category", category);
  if (unreadOnly) query = query.eq("read", false);
  query = recipientFilter(query, { userId, email, audience });

  const { data, error } = await query;
  if (error) return { rows: [], hasMore: false, error };

  const rows = data || [];
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, error: null };
}

/**
 * The true unread count, independent of what is loaded.
 * `head: true` returns the number and no rows at all.
 */
export async function getUnreadCount({ userId, email, audience = "admin" } = {}) {
  const orgId = getOrgId();
  let query = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("read", false);

  if (orgId) query = query.eq("organization_id", orgId);
  query = recipientFilter(query, { userId, email, audience });

  const { count, error } = await query;
  if (error) return { count: 0, error };
  return { count: count ?? 0, error: null };
}

/** Mark one notification read. RLS restricts this to rows you can see. */
export async function markRead(id) {
  if (!id) return { error: new Error("Missing notification id") };
  const { error } = await supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("read", false);
  return { error };
}

/**
 * Mark every unread notification read — by predicate, not by the ids currently
 * on screen. Marking only the loaded page left everything past it unread while
 * telling the user it was all handled.
 */
export async function markAllRead({ userId, email, audience = "admin" } = {}) {
  const orgId = getOrgId();
  let query = supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("read", false);

  if (orgId) query = query.eq("organization_id", orgId);
  query = recipientFilter(query, { userId, email, audience });

  const { error } = await query;
  return { error };
}

/**
 * Create a notification.
 *
 * `dedupeKey` makes the write idempotent: migration 029 has a partial unique
 * index on it, so a repeated event (an automation replaying a status change, a
 * cron run firing twice in a day) inserts once. A duplicate is reported as
 * success with `duplicate: true`, because from the caller's point of view the
 * notification exists.
 *
 * Never notifies someone about their own action — an actor who is also the
 * recipient is a no-op.
 */
export async function notify({
  audience = "developer",
  recipientId = null,
  recipientEmail = null,
  category = "general",
  type = null,
  title = null,
  message,
  taskId = null,
  projectId = null,
  submissionId = null,
  entityType = null,
  entityId = null,
  dedupeKey = null,
} = {}) {
  if (!message) return { error: new Error("A notification needs a message") };

  const ctx = getOrgContext();
  const actorId = ctx?.userId || null;

  if (recipientId && actorId && String(recipientId) === String(actorId)) {
    return { error: null, skipped: "self" };
  }
  if (!recipientId && !recipientEmail) {
    return { error: null, skipped: "no-recipient" };
  }

  const row = {
    organization_id: getOrgId(),
    category,
    type: type || category,
    title,
    message,
    task_id: taskId,
    project_id: projectId,
    submission_id: submissionId,
    entity_type: entityType,
    entity_id: entityId,
    actor_id: actorId,
    dedupe_key: dedupeKey,
    read: false,
  };

  if (audience === "admin") {
    row.admin_id = recipientId ? String(recipientId) : null;
    row.admin_email = recipientEmail;
  } else {
    row.developer_id = recipientId;
    row.assigned_developer_id = recipientId;
  }

  const { error } = await supabase.from("notifications").insert(row);
  if (error) {
    // 23505 = the dedupe key already exists, i.e. this event was already sent.
    if (error.code === "23505") return { error: null, duplicate: true };
    return { error };
  }
  return { error: null };
}

/**
 * A stable dedupe key. Includes the day so a recurring daily event (a due
 * reminder) sends once per day rather than once ever.
 */
export function dailyDedupeKey(kind, entityId, recipientId) {
  const day = new Date().toISOString().slice(0, 10);
  return `${kind}:${entityId}:${recipientId}:${day}`;
}
