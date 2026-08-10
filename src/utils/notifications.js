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
  // Written by job 4 in /api/cron — see src/utils/signals.js. It gets its own
  // category rather than falling through to `general` for two reasons: these
  // are the only notifications that assert something about a named person's
  // working pattern, so they must be filterable on their own; and the
  // preference row keyed on this category is the switch that turns the whole
  // feature off for someone who does not want it. Landing in `general` would
  // have made both impossible while looking like it worked.
  signal: { label: "Needs attention", tone: "warning", icon: "Siren" },
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

  // `/developer/project-details` identifies a project by `id` and nothing else,
  // so every developer link has to carry that one param — any other spelling
  // renders the page's empty shell with no project and no tasks.
  const developerProject = (projectId) => `/developer/project-details?id=${projectId}`;

  if (n.task_id) {
    // The admin board is one screen for the whole org, so `section=board` is
    // the destination on its own and the link lands correctly without `task`.
    // Nothing reads `task` yet — the board's drawer is driven by local state —
    // so it identifies the subject rather than opening it.
    //
    // The developer surface has no task route at all: a task is reached
    // through its project, so a task notification is only linkable when the
    // row says which project that is. A link to the project-less page renders
    // an empty shell, which is worse than no link.
    if (audience === "admin") return `${adminBase}?section=board&task=${n.task_id}`;
    return n.project_id ? developerProject(n.project_id) : null;
  }
  if (n.submission_id) {
    return audience === "admin" ? `${adminBase}?section=task-reviews` : null;
  }
  if (n.project_id) {
    return audience === "admin" ? `/admin/project-details/${n.project_id}` : developerProject(n.project_id);
  }
  if (n.entity_type === "sprint") return audience === "admin" ? `${adminBase}?section=sprints` : null;
  if (n.entity_type === "employee") return audience === "admin" ? `${adminBase}?section=employees` : null;
  if (n.entity_type === "team") return audience === "admin" ? `${adminBase}?section=team-stats` : null;
  // Signals land on the overview, where the panel that produced them lives —
  // and last, so a signal that names a project or a sprint still goes to the
  // specific screen via the branches above. There is deliberately no developer
  // destination: signals are only ever addressed to owner, admin, hr and
  // managers, so a developer audience reaching this line is already wrong.
  if (n.category === "signal" || n.type === "signal") {
    return audience === "admin" ? `${adminBase}?section=overview` : null;
  }
  return null;
}

/**
 * A value safe to drop into a PostgREST `or=` list.
 *
 * That list is parsed on commas and parentheses, all three of which are legal
 * in an email address: `"a,b"@x.com` would be read as the end of one clause and
 * the start of another, and the whole query comes back 400. Double-quoting the
 * value keeps it a single token, with backslash and quote escaped inside.
 */
function pgrstLiteral(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The filter that selects "notifications addressed to me".
 *
 * The admin address is matched with `eq`, never `ilike`. Under LIKE an
 * underscore matches any single character, so an address is a pattern rather
 * than a value: `john_doe@acme.com` also selects `john.doe@acme.com`, and a
 * `%…%` containment matches `sara@acme.com` inside `sara@acme.com.au`. Either
 * one hands an admin another admin's notifications — to read, and (through the
 * same filter in `markAllRead`) to mark read.
 *
 * `eq` is case-sensitive where `ilike` was not, so the lower-cased form is
 * offered alongside the address as typed; addresses are stored lower-cased in
 * practice and this keeps a session that carries mixed case matching them.
 */
export function recipientClauses({ userId, email, audience = "admin" } = {}) {
  const clauses = [];
  if (audience === "admin") {
    if (userId) clauses.push(`admin_id.eq.${pgrstLiteral(userId)}`);
    if (email) {
      clauses.push(`admin_email.eq.${pgrstLiteral(email)}`);
      const lower = String(email).toLowerCase();
      if (lower !== String(email)) clauses.push(`admin_email.eq.${pgrstLiteral(lower)}`);
    }
  } else {
    if (userId) clauses.push(`developer_id.eq.${pgrstLiteral(userId)}`);
    if (userId) clauses.push(`assigned_developer_id.eq.${pgrstLiteral(userId)}`);
  }
  return clauses;
}

function recipientFilter(query, { userId, email, audience }) {
  const clauses = recipientClauses({ userId, email, audience });
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
  // A dismissed row is one the user has already taken off their list. It is
  // kept in the table so "I never got that" stays answerable, but it is not
  // theirs to see again — every reader of this list applies the same predicate,
  // which is why it lives here and not in each caller.
  query = query.is("dismissed_at", null);
  query = recipientFilter(query, { userId, email, audience });

  const { data, error } = await query;
  if (error) return { rows: [], hasMore: false, error };

  const rows = data || [];
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, error: null };
}

/**
 * The true unread count, independent of what is loaded.
 * `head: true` returns the number and no rows at all.
 *
 * `category` narrows the count to one group, which is what a caller that is
 * also showing a narrowed list has to ask for; omit it for the whole inbox.
 * There is no `unreadOnly` parameter because unread IS the predicate here.
 */
export async function getUnreadCount({ userId, email, audience = "admin", category = null } = {}) {
  const orgId = getOrgId();
  let query = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("read", false);

  if (orgId) query = query.eq("organization_id", orgId);
  if (category) query = query.eq("category", category);
  // The badge counts what the list can show. Without this a dismissed-but-
  // unread row leaves a badge pointing at a list that does not contain it —
  // a number the user cannot clear because they cannot find what it counts.
  query = query.is("dismissed_at", null);
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
 *
 * `category` scopes it to the group the caller is showing. "Mark all as read"
 * means the list under it, so filtered to Mentions with three rows visible it
 * has to clear three — clearing the other two hundred across every category is
 * an unasked-for, unrecoverable bulk action fired from a one-word button.
 * Unread is already the predicate, so `unreadOnly` needs no separate clause.
 */
export async function markAllRead({ userId, email, audience = "admin", category = null } = {}) {
  const orgId = getOrgId();
  let query = supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("read", false);

  if (orgId) query = query.eq("organization_id", orgId);
  if (category) query = query.eq("category", category);
  // The same predicate the count uses, so the button clears exactly the set the
  // number over it describes — and so a row the user dismissed is not silently
  // written to by a button they pressed about a list it is not in.
  query = query.is("dismissed_at", null);
  query = recipientFilter(query, { userId, email, audience });

  const { error } = await query;
  return { error };
}

/**
 * Take one notification off the list without destroying the record of it.
 *
 * A dismissal writes `dismissed_at` rather than deleting the row. What was sent
 * is the only thing that can answer "I never got that", and a deleted row
 * answers it with silence — which is indistinguishable from never having sent
 * it at all.
 *
 * `is("dismissed_at", null)` makes a repeat a no-op: a double click, or a retry
 * after a response that was slow rather than lost, would otherwise move the
 * timestamp and misreport when the row actually left the list.
 */
export async function dismissNotification(id) {
  if (!id) return { error: new Error("Missing notification id") };
  const { error } = await supabase
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .is("dismissed_at", null);
  return { error };
}

/**
 * Which categories this user still wants.
 *
 * `notification_preferences` holds ONLY the exceptions: an absent row means
 * enabled, so a user who has never opened the preferences screen has no rows
 * and wants everything, and a category added later is on for everyone without a
 * backfill. That rule is applied once, here, so no caller has to know it —
 * every key in `CATEGORY_KEYS` comes back with a definite boolean.
 *
 * The defaults are returned alongside an error too. A preferences panel that
 * cannot read the table should still render its switches (in the state a user
 * with no rows is actually in) rather than collapse into nothing.
 */
export async function fetchNotificationPreferences() {
  const preferences = {};
  for (const key of CATEGORY_KEYS) preferences[key] = true;

  const ctx = getOrgContext();
  const userId = ctx?.userId || null;
  if (!userId) return { preferences, error: new Error("Not signed in") };

  let query = supabase
    .from("notification_preferences")
    .select("category, enabled")
    .eq("user_id", userId);

  const orgId = ctx?.organizationId || null;
  if (orgId) query = query.eq("organization_id", orgId);

  const { data, error } = await query;
  if (error) return { preferences, error };

  for (const row of data || []) {
    // A row for a category this build no longer knows about is left alone: the
    // map describes the switches the UI can offer, and inventing a key for a
    // retired category puts an unnamed, unexplainable toggle on the screen.
    if (!row?.category || !(row.category in preferences)) continue;
    preferences[row.category] = row.enabled !== false;
  }
  return { preferences, error: null };
}

/**
 * Switch one category on or off for the signed-in user.
 *
 * `user_id` and `organization_id` are read from the session context and are not
 * parameters. Muting is a per-person setting, so a call that could name someone
 * else is a way to stop another user hearing about something — and the RLS
 * policy on this table exists precisely to refuse that. Taking them as
 * arguments would mean the only thing standing between a mistyped id and a
 * silenced colleague is a policy check that returns an error nobody reads.
 *
 * Switching a category back ON writes `enabled = true` rather than deleting the
 * row. The delivery trigger tests `not enabled`, so an enabled row and an absent
 * row behave identically, and keeping it preserves the record that the choice
 * was made and reversed.
 */
export async function setNotificationPreference(category, enabled) {
  if (!category || !CATEGORY_KEYS.includes(category)) {
    return { error: new Error(`Unknown notification category: ${category}`) };
  }

  const ctx = getOrgContext();
  const userId = ctx?.userId || null;
  const organizationId = ctx?.organizationId || null;
  if (!userId || !organizationId) return { error: new Error("Not signed in") };

  const { error } = await supabase.from("notification_preferences").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      user_type: ctx?.userType || "developer",
      category,
      enabled: Boolean(enabled),
      updated_at: new Date().toISOString(),
    },
    // Exactly the columns of `uq_notification_prefs_user_category`. Naming any
    // other set (organization_id, say) matches no unique index, and PostgREST
    // answers that with a 42P10 rather than an insert — so the second time a
    // user touched a switch it would fail instead of updating.
    { onConflict: "user_id,category" }
  );
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
  // Structured context a card can render without a second query — a task
  // title, an old and new value, the other person's name in a hand-over.
  metadata = null,
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
    metadata: metadata && typeof metadata === "object" ? metadata : {},
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
    // 23505 is only *this* module's expected outcome when a dedupe key was
    // offered: the partial unique index that reports it is defined `where
    // dedupe_key is not null`, so without a key it provably cannot be the
    // index that fired. Any other unique violation — a primary key clash, a
    // constraint added later — is a real failure, and swallowing it reports a
    // notification as sent that does not exist.
    if (error.code === "23505" && dedupeKey != null) return { error: null, duplicate: true };
    return { error };
  }
  return { error: null };
}

/**
 * A stable dedupe key. Includes the day so a recurring daily event (a due
 * reminder) sends once per day rather than once ever.
 *
 * Only for events that are *meant* to happen at most once a day. Anything a
 * user can legitimately repeat sooner needs `windowedDedupeKey` — see there.
 */
export function dailyDedupeKey(kind, entityId, recipientId) {
  const day = new Date().toISOString().slice(0, 10);
  return `${kind}:${entityId}:${recipientId}:${day}`;
}

/**
 * A dedupe key that suppresses repeats only inside a short window.
 *
 * The duplicates worth suppressing are mechanical and near-instant: an
 * automation replaying an event, two clicks racing the same read. Genuine
 * repeats are separated by however long a person takes, so a window measured
 * in minutes tells the two apart. A day cannot: it silences everything after
 * the first occurrence, and a user who legitimately repeats an action is told
 * nothing and has no way to know they were not told.
 *
 * Rounding to a bucket means two events either side of a boundary both send.
 * That is the safe direction to be wrong in — a rare duplicate is visible and
 * dismissible, a dropped notification is neither.
 */
export function windowedDedupeKey(kind, entityId, recipientId, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  return `${kind}:${entityId}:${recipientId}:w${bucket}`;
}
