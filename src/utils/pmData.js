import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { notify, windowedDedupeKey } from "@/utils/notifications";

// How close together two identical status changes have to be to count as one
// event rather than two. Covers the mechanical repeats — an automation replay,
// two drags racing the same read of the row — and nothing a person does.
const STATUS_REPLAY_WINDOW_MS = 2 * 60 * 1000;

/**
 * Data access for the Enterprise Project Management module.
 *
 * Extends the existing developer_tasks / projects model (never replaces it) and
 * the new PM tables from migration 016. Everything is org-scoped and uses the
 * logged-in user's JWT (RLS permits non-clients, denies clients).
 */

// The existing task status pipeline doubles as default Kanban columns.
// `reviewOnly` columns are outcomes of the admin review workflow: they are
// shown and counted like any other column, but nothing can be moved into them
// by hand — see changeTaskStatus() below.
export const BOARD_COLUMNS = [
  { id: "pending", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "awaiting_approval", label: "In Review" },
  { id: "completed", label: "Done", reviewOnly: true },
  { id: "rejected", label: "Rejected", reviewOnly: true },
];

// Columns a user may drag a card into / create a task in.
export const DRAGGABLE_COLUMNS = BOARD_COLUMNS.filter((c) => !c.reviewOnly);

export const PRIORITIES = ["low", "medium", "high", "urgent"];

// Task types (017). 'story' = a Jira-style user story (usually under an epic).
export const TASK_TYPES = ["feature", "bug", "improvement", "research", "documentation", "story"];

export const SPRINT_STATUS = ["planned", "active", "completed"];

// The multiple-view types (ClickUp-style). 'kanban' reuses the board columns.
export const VIEW_TYPES = ["kanban", "list", "table", "calendar", "timeline", "workload"];

// Canonical column metadata (shared by every view for consistent labels/tones).
export const STATUS_META = {
  pending: { label: "To Do", tone: "muted" },
  in_progress: { label: "In Progress", tone: "info" },
  awaiting_approval: { label: "In Review", tone: "warning" },
  completed: { label: "Done", tone: "success" },
  rejected: { label: "Rejected", tone: "destructive" },
};

// Map any off-pipeline status onto one of the visible board columns.
// `rejected` is deliberately NOT aliased: folding it into To Do hid failed work
// among fresh work, where it could be picked up and closed as if it had never
// been reviewed.
const STATUS_ALIAS = {
  reviewed: "awaiting_approval",
  in_review: "awaiting_approval",
  todo: "pending",
  open: "pending",
  doing: "in_progress",
  done: "completed",
  approved: "completed",
};
const COLUMN_ID_SET = new Set(BOARD_COLUMNS.map((c) => c.id));
export function normalizeStatus(status) {
  if (status && COLUMN_ID_SET.has(status)) return status;
  if (status && STATUS_ALIAS[status]) return STATUS_ALIAS[status];
  return "pending";
}

// ---- Status transitions ----------------------------------------------
// `completed` and `rejected` are the recorded outcome of a review: they carry
// is_on_time, productivity_points, an admin_reviews row, the productivity_metrics
// rollup and the developer's notification. A plain update({status}) from a board
// or a dropdown produces none of that, so those two statuses are owned by the
// review route and unreachable from any UI write.
export const REVIEW_ONLY_STATUSES = new Set(["completed", "rejected"]);

// The states a task can be reviewed from — i.e. it has been submitted.
export const REVIEWABLE_STATUSES = new Set(["awaiting_approval", "reviewed"]);

// Legal hand-driven moves. `completed` has no exits: reopening approved work
// would leave its productivity record attached to a task that is no longer done.
export const STATUS_TRANSITIONS = {
  pending: ["in_progress", "awaiting_approval"],
  in_progress: ["pending", "awaiting_approval"],
  awaiting_approval: ["in_progress", "reviewed"],
  reviewed: ["awaiting_approval", "in_progress"],
  rejected: ["in_progress"],
  completed: [],
};

export function allowedTransitions(from) {
  return STATUS_TRANSITIONS[from || "pending"] || [];
}

export function isTransitionAllowed(from, to) {
  if (!to) return false;
  if (from === to) return true;
  return allowedTransitions(from).includes(to);
}

const statusLabel = (s) => STATUS_META[s]?.label || s;

function transitionError(from, to) {
  if (REVIEW_ONLY_STATUSES.has(to)) {
    return new Error(
      `"${statusLabel(to)}" is decided in review — the assignee submits proof of work and a reviewer approves or rejects it.`
    );
  }
  if (from === "completed") {
    return new Error(
      `This task is already ${statusLabel("completed")}. Reopening approved work would strip its productivity record.`
    );
  }
  return new Error(`A task cannot go from "${statusLabel(from)}" to "${statusLabel(to)}".`);
}

// ---- Paging ----------------------------------------------------------
// PostgREST caps a single response at 1000 rows and says nothing about it, so
// an unpaged `.select()` silently returns a partial set that then gets counted,
// grouped and charted as if it were everything. Walk explicit ranges instead,
// and stop at a ceiling so one large tenant cannot exhaust the browser.
const PAGE_SIZE = 1000;
const MAX_TASK_ROWS = 10000;
const MAX_TIME_LOG_ROWS = 10000;

async function fetchPaged(buildQuery, maxRows) {
  const rows = [];
  let truncated = false;
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const size = Math.min(PAGE_SIZE, maxRows - offset);
    const { data, error } = await buildQuery().range(offset, offset + size - 1);
    if (error) return { rows, error, truncated };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < size) return { rows, error: null, truncated: false };
    if (rows.length >= maxRows) truncated = true;
  }
  return { rows, error: null, truncated };
}

// ---- Tasks -----------------------------------------------------------
// `truncated` is additive — existing callers destructure { tasks, error } and
// are unaffected.
export async function loadTasks(projectId) {
  const orgId = getOrgId();
  const build = () => {
    let q = supabase
      .from("developer_tasks")
      .select("*")
      .order("position", { ascending: true, nullsFirst: false })
      .order("task_order", { ascending: true })
      // Ties on position/task_order would otherwise let a row appear on two
      // pages or on none, so the ranges need a stable final sort key.
      .order("id", { ascending: true });
    if (projectId) q = q.eq("project_id", projectId);
    else if (orgId) q = q.eq("organization_id", orgId);
    return q;
  };
  const { rows, error, truncated } = await fetchPaged(build, MAX_TASK_ROWS);
  return { tasks: rows, error, truncated };
}

export async function createTask(projectId, patch) {
  const orgId = getOrgId();
  const row = {
    organization_id: orgId,
    project_id: projectId,
    task_title: patch.task_title || "Untitled task",
    status: patch.status || "pending",
    priority: patch.priority || "medium",
    // developer_tasks requires start_date/end_date NOT NULL in the base schema.
    start_date: patch.start_date || new Date().toISOString().slice(0, 10),
    end_date: patch.end_date || patch.due_date || new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString(),
    ...patch,
  };
  // Nothing starts life already approved or rejected — those come from review.
  if (REVIEW_ONLY_STATUSES.has(row.status)) row.status = "pending";
  const { data, error } = await supabase.from("developer_tasks").insert(row).select().single();
  if (!error && data) {
    // Fire "task created" automations. Best-effort: never blocks task creation.
    try {
      const { runAutomations } = await import("@/utils/automation");
      await runAutomations({ event: "task_created", task: data, projectId });
    } catch {
      /* automation is non-critical */
    }
  }
  return { task: data, error };
}

// updateTask(taskId, patch, logCtx?) — logCtx is optional; when provided
// ({ projectId, action, meta }) an entry is written to the pm_activity feed.
// Callers that omit logCtx behave exactly as before (no logging).
export async function updateTask(taskId, patch, logCtx = null) {
  const { error } = await supabase
    .from("developer_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (!error && logCtx) {
    try {
      await logActivity({
        projectId: logCtx.projectId || null,
        entityType: "task",
        entityId: taskId,
        action: logCtx.action || "updated",
        meta: logCtx.meta || {},
      });
    } catch {
      /* activity logging is best-effort */
    }
  }
  return { error };
}

const TASK_SNAPSHOT = "id, status, priority, task_type, developer_id, project_id, labels, task_title";

/**
 * The single guarded entry point for every task status change driven by a
 * human: board drag-drop, the detail drawer dropdown, automations.
 *
 * - illegal moves are refused with a message the UI can show;
 * - `completed` / `rejected` are handed to the review workflow instead of being
 *   written to the column, so submissions, on-time state, productivity points,
 *   the project rollup and the developer notification all stay in step;
 * - legal moves fire the same "status changed" automations as before.
 *
 * Returns { error } — plus { task } / { reviewed } on success.
 */
export async function changeTaskStatus(taskId, nextStatus, options = {}) {
  const { position, logCtx = null, comments = null, rejectionReason = null } = options;
  if (!taskId || !nextStatus) return { error: new Error("Missing task or status") };

  const { data: prev, error: readErr } = await supabase
    .from("developer_tasks")
    .select(TASK_SNAPSHOT)
    .eq("id", taskId)
    .single();
  if (readErr || !prev) return { error: readErr || new Error("Task not found") };

  const from = prev.status || "pending";
  if (from === nextStatus) return { error: null, task: prev };

  if (REVIEW_ONLY_STATUSES.has(nextStatus)) {
    // A task only reaches review once it has been submitted.
    if (!REVIEWABLE_STATUSES.has(from)) return { error: transitionError(from, nextStatus) };
    return reviewTask(taskId, nextStatus === "completed" ? "approve" : "reject", {
      comments,
      rejectionReason,
      task: prev,
    });
  }

  if (!isTransitionAllowed(from, nextStatus)) return { error: transitionError(from, nextStatus) };

  const patch = { status: nextStatus };
  if (position !== undefined) patch.position = position;
  const res = await updateTask(taskId, patch, logCtx);
  if (res.error) return res;

  try {
    const { runAutomations } = await import("@/utils/automation");
    await runAutomations({
      event: "status_changed",
      task: { ...prev, status: nextStatus },
      prev,
      projectId: prev.project_id,
    });
  } catch {
    /* automation is non-critical */
  }

  // Tell the assignee their work moved. Only non-terminal moves reach this
  // point — `completed` / `rejected` were handed to reviewTask above and the
  // review route sends its own notification, so there is no second one here.
  try {
    if (prev.developer_id) {
      await notify({
        audience: "developer",
        recipientId: prev.developer_id,
        category: "status",
        type: "task_status_changed",
        title: "Task status changed",
        message: `"${prev.task_title || "A task"}" moved from ${statusLabel(from)} to ${statusLabel(nextStatus)}.`,
        taskId,
        projectId: prev.project_id || null,
        // Keyed by the whole transition and a short window, because the same
        // destination is reached legitimately more than once a day: sent back
        // for changes and resubmitted walks in_progress -> awaiting_approval
        // twice, and the second submission is exactly the one the reviewer is
        // waiting on. Keying on the destination and the calendar day announced
        // the first and silently swallowed every one after it.
        dedupeKey: windowedDedupeKey(
          `status:${from}>${nextStatus}`,
          taskId,
          prev.developer_id,
          STATUS_REPLAY_WINDOW_MS
        ),
      });
    }
  } catch {
    /* the status is already saved — failing to announce it must not undo that */
  }
  return { error: null, task: { ...prev, status: nextStatus } };
}

/**
 * Approve or reject through /api/admin-review — the only path that writes a
 * terminal status. It stamps is_on_time / productivity_points / the completion
 * date, records the admin_reviews row, recomputes productivity_metrics and the
 * project progress, and notifies the developer.
 */
export async function reviewTask(taskId, action, { comments = null, rejectionReason = null, task = null } = {}) {
  const ctx = getOrgContext();
  const { data: pendingSubs } = await supabase
    .from("task_submissions")
    .select("id, submitted_at")
    .eq("task_id", taskId)
    .eq("review_status", "pending")
    .order("submitted_at", { ascending: false })
    .limit(1);
  const submission = (pendingSubs || [])[0];
  if (!submission) {
    return {
      error: new Error(
        "There is nothing to review — the assignee has to submit proof of work before this task can be approved or rejected."
      ),
    };
  }
  if (action === "reject" && !rejectionReason) {
    return {
      error: new Error(
        "A rejection has to carry a reason. Reject it from Task Reviews so the developer is told what to fix."
      ),
    };
  }

  try {
    const res = await authFetch("/api/admin-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: submission.id,
        taskId,
        adminId: ctx?.userId || null,
        action,
        comments,
        rejectionReason,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.success) {
      return { error: new Error(payload?.error || `Review failed (${res.status})`) };
    }
    const status = payload?.task?.status || (action === "approve" ? "completed" : "rejected");
    return { error: null, reviewed: true, task: task ? { ...task, status } : null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Move a task to a new status column / position (Kanban drag-drop).
// Kept as the board-facing name; the transition rules live in changeTaskStatus.
export async function moveTask(taskId, { status, position }, logCtx = null) {
  return changeTaskStatus(taskId, status, { position, logCtx });
}

// Assign a task, tell the new assignee, and fire "assigned" automations.
//
// Assignment was the one workflow event that produced no notification: the
// person picked up work only by noticing it on a board. It is also why the
// "assigned" automation trigger never fired - the drawer wrote the column
// directly and never came through here.
export async function assignTask(taskId, developerId, logCtx = null) {
  const res = await updateTask(taskId, { developer_id: developerId || null }, logCtx);
  if (res.error || !developerId) return res;

  try {
    const { data } = await supabase
      .from("developer_tasks")
      .select("id, status, priority, task_type, developer_id, project_id, labels, task_title, organization_id")
      .eq("id", taskId)
      .single();
    if (!data) return res;

    await supabase.from("notifications").insert({
      organization_id: data.organization_id || getOrgId(),
      developer_id: developerId,
      task_id: taskId,
      project_id: data.project_id || null,
      type: "task_assigned",
      title: "Task assigned to you",
      message: `You have been assigned "${data.task_title || "a task"}".`,
      read: false,
    });

    const { runAutomations } = await import("@/utils/automation");
    await runAutomations({ event: "assigned", task: data, projectId: data.project_id });
  } catch {
    /* neither the notification nor the automation should fail the assignment */
  }
  return res;
}

// ---- Sprints & Epics -------------------------------------------------
export async function loadSprints(projectId) {
  const orgId = getOrgId();
  let q = supabase.from("sprints").select("*").eq("organization_id", orgId).order("sort_order");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
}
export async function loadEpics(projectId) {
  const orgId = getOrgId();
  let q = supabase.from("epics").select("*").eq("organization_id", orgId);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
}
export async function saveSprint(projectId, patch) {
  const orgId = getOrgId();
  if (patch.id) {
    const { error } = await supabase.from("sprints").update(patch).eq("id", patch.id);
    return { error };
  }
  const { data, error } = await supabase
    .from("sprints")
    .insert({ organization_id: orgId, project_id: projectId, ...patch })
    .select()
    .single();
  return { sprint: data, error };
}
export async function saveEpic(projectId, patch) {
  const orgId = getOrgId();
  if (patch.id) {
    const { error } = await supabase.from("epics").update(patch).eq("id", patch.id);
    return { error };
  }
  const { data, error } = await supabase
    .from("epics")
    .insert({ organization_id: orgId, project_id: projectId, ...patch })
    .select()
    .single();
  return { epic: data, error };
}

// ---- Task detail sub-resources --------------------------------------
export async function loadTaskDetail(taskId) {
  const orgId = getOrgId();
  const [{ data: comments }, { data: checklist }, { data: watchers }, { data: attachments }, { data: deps }] =
    await Promise.all([
      supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"),
      supabase.from("task_checklists").select("*").eq("task_id", taskId).order("sort_order"),
      supabase.from("task_watchers").select("*").eq("task_id", taskId),
      supabase.from("task_attachments").select("*").eq("task_id", taskId).order("created_at", { ascending: false }),
      supabase.from("task_dependencies").select("*").eq("task_id", taskId),
    ]);
  return {
    comments: comments || [],
    checklist: checklist || [],
    watchers: watchers || [],
    attachments: attachments || [],
    dependencies: deps || [],
    orgId,
  };
}

/**
 * The org's member directory as { userId, userType, email, name }.
 *
 * Names are stitched the same way the employee list stitches them, because a
 * mention is typed against what the UI displayed. Three queries for the whole
 * org, never one per name found in the body.
 */
async function loadOrgMembers(orgId) {
  if (!orgId) return [];
  const [{ data: mem }, { data: devs }, { data: admins }] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, user_type, email")
      .eq("organization_id", orgId)
      .neq("user_type", "client"),
    supabase.from("developers").select("id, name, email").eq("organization_id", orgId),
    supabase.from("admin_users").select("id, full_name, email").eq("organization_id", orgId),
  ]);

  const devById = new Map((devs || []).map((d) => [String(d.id), d]));
  const adminById = new Map((admins || []).map((a) => [String(a.id), a]));
  return (mem || []).map((m) => {
    const person = m.user_type === "admin" ? adminById.get(String(m.user_id)) : devById.get(String(m.user_id));
    const email = person?.email || m.email || "";
    return {
      userId: m.user_id,
      userType: m.user_type,
      email,
      name: person?.full_name || person?.name || (email ? email.split("@")[0] : ""),
    };
  });
}

/**
 * Which members a comment body names.
 *
 * Two passes, because there are two ways a mention gets into the text. The
 * picker inserts a member's display name verbatim — "@Sara Okonkwo", space and
 * all — which no token scan would ever recover, so full names are matched
 * against the whole body. Hand-typed mentions are single tokens, so those are
 * scanned and looked up by first name or email handle. A short form claimed by
 * two members is ambiguous and is dropped rather than guessed at: a mention
 * that reaches the wrong person is worse than one that reaches nobody.
 */
/**
 * Is `@phrase` a whole mention in `text`, rather than the start of a longer one?
 *
 * Plain containment is not enough in either direction. "@alina costa" contains
 * "@ali", so a member called Ali was notified about every mention of Alina —
 * and since a mention outranks a watch, it also replaced the ordinary comment
 * notification Ali was owed. The name has to end where the mention ends.
 */
export function mentionsPhrase(text, phrase) {
  const needle = `@${String(phrase || "").toLowerCase()}`;
  if (!phrase) return false;
  const haystack = String(text || "").toLowerCase();

  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    from = at;

    // The `@` has to open the mention, matching the token scanner below, so
    // that the local part of "sara@acme.com" is not read as naming Acme.
    const before = at === 0 ? "" : haystack[at - 1];
    if (/[\w@]/.test(before)) continue;

    const after = haystack.slice(at + needle.length);
    // A name may not run straight into more name.
    if (/^[\w@-]/.test(after)) continue;
    // A full stop ends the mention only when it also ends the sentence, so
    // "@ali." is Ali and "@ali.hassan" is somebody else entirely.
    if (/^\.\S/.test(after)) continue;
    return true;
  }
}

export function resolveMentions(body, members) {
  const text = String(body || "").toLowerCase();
  const hits = new Set();
  if (!text.includes("@") || !members.length) return hits;

  const byShortForm = new Map();
  for (const m of members) {
    const name = (m.name || "").trim().toLowerCase();
    const handle = (m.email || "").split("@")[0].toLowerCase();
    if (name && mentionsPhrase(text, name)) hits.add(String(m.userId));
    // A member whose first name is also their email handle — Sara Okonkwo at
    // sara@… , which is the ordinary case — claims ONE short form, not two.
    // Counting it twice made every such member ambiguous with themselves and
    // dropped as unresolvable, so "@sara" reached nobody.
    for (const key of new Set([name.split(/\s+/)[0], handle])) {
      if (!key) continue;
      const held = byShortForm.get(key);
      if (held === undefined) byShortForm.set(key, m);
      // Ambiguous only against a DIFFERENT member; once ambiguous, it stays so.
      else if (held && String(held.userId) !== String(m.userId)) byShortForm.set(key, null);
    }
  }

  const token = /(?:^|[^\w@])@([a-z0-9][a-z0-9._-]{0,63})/g;
  let match;
  while ((match = token.exec(text)) !== null) {
    // Trailing punctuation belongs to the sentence, not to the name.
    const hit = byShortForm.get(match[1].replace(/[._-]+$/, ""));
    if (hit) hits.add(String(hit.userId));
  }
  return hits;
}

const commentAudience = (userType) => (userType === "admin" ? "admin" : "developer");

/**
 * Tell the people attached to a task that it has a new comment.
 *
 * Mention beats watch. Someone who is both named in the body and watching the
 * task gets exactly one notification — the mention — because that is the one
 * that is actually asking them for something, and two rows about a single
 * comment read as two comments.
 */
async function notifyComment(taskId, comment, body, mentions) {
  const commentId = comment?.id;
  if (!commentId) return;
  const requested = mentions || [];
  const mayMention = String(body || "").includes("@") || requested.length > 0;

  // Every recipient set is one query. The directory is only paid for when the
  // body could name somebody.
  const [{ data: task }, { data: watchers }, members] = await Promise.all([
    supabase
      .from("developer_tasks")
      .select("id, task_title, project_id, developer_id")
      .eq("id", taskId)
      .single(),
    supabase.from("task_watchers").select("user_id, user_type").eq("task_id", taskId),
    mayMention ? loadOrgMembers(getOrgId()) : Promise.resolve([]),
  ]);
  if (!task) return;

  const memberById = new Map(members.map((m) => [String(m.userId), m]));
  const mentioned = resolveMentions(body, members);
  // The composer also reports the ids it inserted, which covers a display name
  // the directory spells differently from what was typed.
  for (const id of requested) if (memberById.has(String(id))) mentioned.add(String(id));

  const title = task.task_title || "a task";
  const excerpt = String(body || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const sends = [];

  for (const id of mentioned) {
    const m = memberById.get(id);
    sends.push(
      notify({
        audience: commentAudience(m?.userType),
        recipientId: id,
        recipientEmail: m?.userType === "admin" ? m.email || null : null,
        category: "mention",
        type: "comment_mention",
        title: "You were mentioned",
        message: `You were mentioned in a comment on "${title}": ${excerpt}`,
        taskId,
        projectId: task.project_id || null,
        dedupeKey: `mention:${commentId}:${id}`,
      })
    );
  }

  // The assignee is a watcher in all but name, so they go into the same map and
  // are collapsed with the real watchers before anything is sent.
  const followers = new Map();
  if (task.developer_id) followers.set(String(task.developer_id), "developer");
  for (const w of watchers || []) {
    if (!w?.user_id) continue;
    // A client watcher is skipped, not downgraded. `commentAudience` maps any
    // non-admin to "developer", which would address the row developer_id=<a
    // client> — and the read policy ends `not auth_is_client()`, so that row is
    // unreadable by the only person it is for and by everyone else too. It
    // would sit in the table forever, counted by nobody's badge. Clients follow
    // work through the client portal, which is not this table.
    if (w.user_type === "client") continue;
    followers.set(String(w.user_id), commentAudience(w.user_type));
  }

  for (const [id, audience] of followers) {
    if (mentioned.has(id)) continue; // already told, and told more pointedly
    const m = memberById.get(id);
    sends.push(
      notify({
        audience,
        recipientId: id,
        recipientEmail: audience === "admin" ? m?.email || null : null,
        category: "comment",
        type: "task_comment",
        title: "New comment",
        message: `New comment on "${title}": ${excerpt}`,
        taskId,
        projectId: task.project_id || null,
        dedupeKey: `comment:${commentId}:${id}`,
      })
    );
  }

  await Promise.all(sends);
}

export async function addComment(taskId, body, mentions = []) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  const { data, error } = await supabase
    .from("task_comments")
    .insert({
      organization_id: orgId,
      task_id: taskId,
      author_id: ctx?.userId || null,
      author_type: ctx?.userType || null,
      author_name: ctx?.organizationName ? undefined : undefined, // resolved by caller if needed
      body,
      mentions,
    })
    .select()
    .single();

  if (!error && data) {
    try {
      await notifyComment(taskId, data, body, mentions);
    } catch {
      /* a comment must still post when there is nobody to tell, or telling fails */
    }
  }
  return { comment: data, error };
}

export async function addChecklistItem(taskId, text) {
  const orgId = getOrgId();
  const { data, error } = await supabase
    .from("task_checklists")
    .insert({ organization_id: orgId, task_id: taskId, text })
    .select()
    .single();
  return { item: data, error };
}
export async function toggleChecklistItem(id, done) {
  const { error } = await supabase.from("task_checklists").update({ done }).eq("id", id);
  return { error };
}

export async function toggleWatcher(taskId, userId, userType, role = "watcher", on = true) {
  const orgId = getOrgId();
  if (on) {
    const { error } = await supabase
      .from("task_watchers")
      .upsert({ organization_id: orgId, task_id: taskId, user_id: userId, user_type: userType, role }, { onConflict: "task_id,user_id,role" });
    return { error };
  }
  const { error } = await supabase
    .from("task_watchers")
    .delete()
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .eq("role", role);
  return { error };
}

export async function addDependency(taskId, dependsOnTaskId, type = "blocks") {
  const orgId = getOrgId();
  const { error } = await supabase
    .from("task_dependencies")
    .insert({ organization_id: orgId, task_id: taskId, depends_on_task_id: dependsOnTaskId, type });
  return { error };
}

// ---- Agile: sprint / epic task assignment ---------------------------
// These only ever touch developer_tasks' additive 016 columns (sprint_id,
// epic_id, task_type, story_points) — the status pipeline is never changed.
// A closed sprint is a historical record. Burndown is recomputed from live rows
// on every render and has no date filter, so adding a task to an already
// completed sprint retroactively changes a chart that was supposed to be
// settled — its total points move and the new task burns on whatever day it was
// last touched. Removal stays allowed: pulling a stranded task back to the
// backlog is how unfinished work leaves a closed sprint.
export async function assignTaskToSprint(taskId, sprintId) {
  if (sprintId) {
    const { data: sprint } = await supabase
      .from("sprints")
      .select("id, name, status")
      .eq("id", sprintId)
      .single();
    if (sprint && sprint.status === "completed") {
      return {
        error: new Error(
          `"${sprint.name || "That sprint"}" is already completed — adding work to it would rewrite its burndown. Move the task to an active or planned sprint instead.`
        ),
      };
    }
  }
  return updateTask(taskId, { sprint_id: sprintId || null });
}
export async function setTaskEpic(taskId, epicId) {
  return updateTask(taskId, { epic_id: epicId || null });
}
export async function setTaskType(taskId, taskType, logCtx = null) {
  return updateTask(taskId, { task_type: taskType || "feature" }, logCtx);
}
export async function setStoryPoints(taskId, points) {
  const n = points === "" || points == null ? null : Number(points);
  return updateTask(taskId, { story_points: Number.isNaN(n) ? null : n });
}

// Everyone carrying work in a sprint hears when it opens or closes — those are
// the two moments that change what they are expected to be doing today. The
// assignees come out of one query over the sprint's tasks and are collapsed in
// memory, so a fifty-task sprint is still two reads.
async function notifySprintStatus(sprintId, status) {
  const [{ data: sprint }, { data: tasks }] = await Promise.all([
    supabase.from("sprints").select("id, name, project_id").eq("id", sprintId).single(),
    supabase.from("developer_tasks").select("developer_id").eq("sprint_id", sprintId),
  ]);

  const recipients = new Set((tasks || []).map((t) => t.developer_id).filter(Boolean).map(String));
  if (!recipients.size) return;

  const started = status === "active";
  const name = sprint?.name || "A sprint";
  await Promise.all(
    [...recipients].map((id) =>
      notify({
        audience: "developer",
        recipientId: id,
        category: "sprint",
        type: started ? "sprint_started" : "sprint_completed",
        title: started ? "Sprint started" : "Sprint completed",
        message: started
          ? `Sprint "${name}" has started — your tasks in it are now in flight.`
          : `Sprint "${name}" has been completed.`,
        projectId: sprint?.project_id || null,
        entityType: "sprint",
        entityId: sprintId,
        // A sprint starts once and ends once, so the key needs no date: a
        // replayed transition lands on the row that is already there.
        dedupeKey: `sprint_${status}:${sprintId}:${id}`,
      })
    )
  );
}

// Move a sprint through planned → active → completed.
export async function setSprintStatus(sprintId, status) {
  const { error } = await supabase.from("sprints").update({ status }).eq("id", sprintId);
  if (!error && (status === "active" || status === "completed")) {
    try {
      await notifySprintStatus(sprintId, status);
    } catch {
      /* the sprint has already moved — announcing it is best effort */
    }
  }
  return { error };
}

// Load everything an agile view needs for one project in one shot.
export async function loadAgile(projectId) {
  const [sprints, epics, { tasks }] = await Promise.all([
    loadSprints(projectId),
    loadEpics(projectId),
    loadTasks(projectId),
  ]);
  return { sprints, epics, tasks };
}

// ---- Burndown ------------------------------------------------------------
// Pure helper (no I/O): builds ideal vs. actual remaining-points series across
// a sprint's date range. "Done" = status completed/reviewed; a task burns down
// on its actual_completion_date (fallback reviewed_at/updated_at). Points fall
// back to 1 when story_points is null so unpointed work still shows movement.
const DONE_STATUSES = new Set(["completed", "reviewed"]);
function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}
export function computeBurndown(sprint, tasks) {
  if (!sprint?.start_date || !sprint?.end_date) return { days: [], ideal: [], actual: [], totalPoints: 0 };
  const items = (tasks || []).filter((t) => String(t.sprint_id || "") === String(sprint.id));
  const pts = (t) => (t.story_points != null ? Number(t.story_points) || 0 : 1);
  const totalPoints = items.reduce((s, t) => s + pts(t), 0);

  const start = new Date(sprint.start_date + "T00:00:00");
  const end = new Date(sprint.end_date + "T00:00:00");
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(ymd(d));
  if (!days.length) return { days: [], ideal: [], actual: [], totalPoints };

  const span = days.length - 1 || 1;
  const ideal = days.map((_, i) => Math.max(0, +(totalPoints - (totalPoints * i) / span).toFixed(2)));

  const today = ymd(new Date());
  const actual = days.map((day) => {
    if (day > today) return null; // don't draw the future
    const burned = items.reduce((s, t) => {
      if (!DONE_STATUSES.has(t.status)) return s;
      const done = t.actual_completion_date || t.reviewed_at || t.updated_at;
      if (done && ymd(done) <= day) return s + pts(t);
      return s;
    }, 0);
    return Math.max(0, +(totalPoints - burned).toFixed(2));
  });

  return { days, ideal, actual, totalPoints };
}

// ---- Saved views (saved_views, 016) -------------------------------------
export async function loadSavedViews(projectId) {
  const orgId = getOrgId();
  let q = supabase.from("saved_views").select("*").eq("organization_id", orgId).order("created_at");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
}
export async function saveView(projectId, { id, name, view_type = "kanban", config = {}, is_shared = false }) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  if (id) {
    const { error } = await supabase
      .from("saved_views")
      .update({ name, view_type, config, is_shared })
      .eq("id", id);
    return { error };
  }
  const { data, error } = await supabase
    .from("saved_views")
    .insert({
      organization_id: orgId,
      project_id: projectId,
      user_id: ctx?.userId || null,
      name,
      view_type,
      config,
      is_shared,
    })
    .select()
    .single();
  return { view: data, error };
}
export async function deleteView(id) {
  const { error } = await supabase.from("saved_views").delete().eq("id", id);
  return { error };
}

// ---- Activity feed (pm_activity, 017) -----------------------------------
export async function logActivity({ projectId, entityType, entityId, action, meta = {} }) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  const { error } = await supabase.from("pm_activity").insert({
    organization_id: orgId,
    project_id: projectId || null,
    entity_type: entityType,
    entity_id: entityId || null,
    action,
    actor_id: ctx?.userId || null,
    // actor display name is resolved by readers via actor_id (like comments);
    // stored only when the caller passes it in meta.actorName.
    actor_name: meta?.actorName || null,
    meta,
  });
  return { error };
}
export async function loadActivity({ projectId, entityType, entityId, limit = 50 } = {}) {
  let q = supabase.from("pm_activity").select("*").order("created_at", { ascending: false }).limit(limit);
  if (projectId) q = q.eq("project_id", projectId);
  if (entityType) q = q.eq("entity_type", entityType);
  if (entityId) q = q.eq("entity_id", entityId);
  const { data } = await q;
  return data || [];
}

// ---- Task time tracking (task_time_logs, 017) -----------------------------
// Explicit per-task timing. This is the ONLY exact task-level time source:
// the desktop tracker records per-developer sessions with no task linkage.

// Seconds → "2h 15m" / "45m" / "30s".
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// The current user's running timer (ended_at is null), if any.
export async function getActiveTimer() {
  const ctx = getOrgContext();
  const orgId = getOrgId();
  if (!ctx?.userId || !orgId) return null;
  const { data } = await supabase
    .from("task_time_logs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("developer_id", ctx.userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}

// Start timing a task. Any other running timer for this user is stopped first
// so a user can only be on one task at a time.
//
// Stopping-then-inserting is a read followed by a write, so two tabs or a
// double click can both pass the read and open two timers whose elapsed time
// then both keep counting. A partial unique index (migration 024) makes the
// database refuse the second one; catching that here turns the collision into
// the timer the user already has rather than an error they cannot act on.
export async function startTaskTimer(taskId, projectId) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  if (!ctx?.userId) return { error: new Error("No signed-in user") };

  const running = await getActiveTimer();
  if (running) {
    if (String(running.task_id) === String(taskId)) return { log: running, error: null };
    await stopTaskTimer(running);
  }

  const { data, error } = await supabase
    .from("task_time_logs")
    .insert({
      organization_id: orgId,
      task_id: taskId,
      project_id: projectId || null,
      developer_id: ctx.userId,
      started_at: new Date().toISOString(),
      source: "web_timer",
    })
    .select()
    .single();

  if (error) {
    // 23505 = another request opened a timer between our read and this insert.
    if (error.code === "23505") {
      const existing = await getActiveTimer();
      if (existing) return { log: existing, error: null };
    }
    return { log: null, error };
  }

  await logActivity({ projectId, entityType: "task", entityId: taskId, action: "timer_started", meta: {} });
  return { log: data, error: null };
}

// Stop a running timer and persist the elapsed seconds.
export async function stopTaskTimer(log, note = null) {
  if (!log?.id) return { error: new Error("No timer to stop") };
  const endedAt = new Date();
  const startedAt = new Date(log.started_at);
  const seconds = Number.isNaN(startedAt.getTime())
    ? 0
    : Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const { error } = await supabase
    .from("task_time_logs")
    .update({ ended_at: endedAt.toISOString(), seconds, note: note || log.note || null })
    .eq("id", log.id);
  if (!error) {
    await logActivity({
      projectId: log.project_id,
      entityType: "task",
      entityId: log.task_id,
      action: "timer_stopped",
      meta: { seconds },
    });
  }
  return { seconds, error };
}

// Manually log time (no live timer) — seconds is required.
export async function addManualTimeLog({ taskId, projectId, seconds, note }) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  const now = new Date();
  const start = new Date(now.getTime() - (Number(seconds) || 0) * 1000);
  const { data, error } = await supabase
    .from("task_time_logs")
    .insert({
      organization_id: orgId,
      task_id: taskId,
      project_id: projectId || null,
      developer_id: ctx?.userId || null,
      started_at: start.toISOString(),
      ended_at: now.toISOString(),
      seconds: Math.max(0, Number(seconds) || 0),
      source: "manual",
      note: note || null,
    })
    .select()
    .single();
  return { log: data, error };
}

export async function loadTimeLogs({ taskId, projectId, developerId, from, to } = {}) {
  const orgId = getOrgId();
  const build = () => {
    let q = supabase
      .from("task_time_logs")
      .select("*")
      .eq("organization_id", orgId)
      .order("started_at", { ascending: false })
      .order("id", { ascending: true });
    if (taskId) q = q.eq("task_id", taskId);
    if (projectId) q = q.eq("project_id", projectId);
    if (developerId) q = q.eq("developer_id", developerId);
    if (from) q = q.gte("started_at", from);
    if (to) q = q.lte("started_at", to);
    return q;
  };
  const { rows } = await fetchPaged(build, MAX_TIME_LOG_ROWS);
  return rows;
}

// Total logged seconds for a task (completed logs only).
export function sumSeconds(logs) {
  return (logs || []).reduce((s, l) => s + (Number(l.seconds) || 0), 0);
}

// ---- Project labels (project_labels, 016) ---------------------------------
export async function loadLabels(projectId) {
  const orgId = getOrgId();
  let q = supabase.from("project_labels").select("*").eq("organization_id", orgId).order("name");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
}
export async function createLabel(projectId, { name, color = "#6C82FF" }) {
  const orgId = getOrgId();
  const { data, error } = await supabase
    .from("project_labels")
    .insert({ organization_id: orgId, project_id: projectId, name, color })
    .select()
    .single();
  return { label: data, error };
}
export async function deleteLabel(id) {
  const { error } = await supabase.from("project_labels").delete().eq("id", id);
  return { error };
}
// Task labels live on developer_tasks.labels (text[]); this just persists them.
export async function setTaskLabels(taskId, labels, logCtx = null) {
  return updateTask(taskId, { labels: labels || [] }, logCtx);
}

// ---- Custom fields (project_custom_fields, 016) ---------------------------
export async function loadCustomFields(projectId) {
  const orgId = getOrgId();
  let q = supabase.from("project_custom_fields").select("*").eq("organization_id", orgId).order("sort_order");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
}
export async function createCustomField(projectId, { name, field_type = "text", options = [] }) {
  const orgId = getOrgId();
  const { data, error } = await supabase
    .from("project_custom_fields")
    .insert({ organization_id: orgId, project_id: projectId, name, field_type, options })
    .select()
    .single();
  return { field: data, error };
}
export async function deleteCustomField(id) {
  const { error } = await supabase.from("project_custom_fields").delete().eq("id", id);
  return { error };
}
// Custom-field values live on developer_tasks.custom_fields (jsonb, keyed by field id).
export async function setTaskCustomFields(taskId, customFields, logCtx = null) {
  return updateTask(taskId, { custom_fields: customFields || {} }, logCtx);
}

// ---- Recurring config (developer_tasks.is_recurring / recurrence) ----------
// Config only; actual spawning is handled by the automation scheduler (Phase E).
export async function setRecurring(taskId, { is_recurring, recurrence }, logCtx = null) {
  return updateTask(taskId, { is_recurring: !!is_recurring, recurrence: recurrence || {} }, logCtx);
}

// ---- Milestones / phases (milestones, 014) --------------------------------
export const MILESTONE_STATUS = ["pending", "in_progress", "completed"];
export async function loadMilestones(projectId) {
  const orgId = getOrgId();
  const { data } = await supabase
    .from("milestones")
    .select("*")
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false });
  return data || [];
}
export async function saveMilestone(projectId, patch) {
  const orgId = getOrgId();
  if (patch.id) {
    const { id, ...rest } = patch;
    const { error } = await supabase
      .from("milestones")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) await logActivity({ projectId, entityType: "milestone", entityId: id, action: "updated", meta: { title: patch.title } });
    return { error };
  }
  const { data, error } = await supabase
    .from("milestones")
    .insert({ organization_id: orgId, project_id: projectId, ...patch })
    .select()
    .single();
  if (!error && data) await logActivity({ projectId, entityType: "milestone", entityId: data.id, action: "created", meta: { title: data.title } });
  return { milestone: data, error };
}
export async function deleteMilestone(id) {
  const { error } = await supabase.from("milestones").delete().eq("id", id);
  return { error };
}

// ---- Project templates (projects.is_template + clone) ----------------------
export async function setProjectTemplate(projectId, isTemplate) {
  const { error } = await supabase.from("projects").update({ is_template: !!isTemplate }).eq("id", projectId);
  return { error };
}
// Clone a project (and optionally its tasks) into a fresh project. Tasks are
// copied with status reset to 'pending' and their PM fields preserved.
export async function cloneProject(sourceProjectId, newName, { copyTasks = true } = {}) {
  const orgId = getOrgId();
  const { data: src, error: srcErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", sourceProjectId)
    .single();
  if (srcErr || !src) return { error: srcErr || new Error("Source project not found") };

  const today = new Date().toISOString().slice(0, 10);
  const {
    id, created_at, updated_at, // stripped
    name, status, progress, total_tasks_count, completed_tasks_count, total_productivity_score,
    task_plan_submitted, task_plan_status, task_plan_submitted_at, task_plan_reviewed_at,
    task_plan_reviewed_by, task_plan_rejection_reason,
    ...carry
  } = src;
  const insertRow = {
    ...carry,
    organization_id: orgId,
    name: newName || `${name} (copy)`,
    status: "pending",
    progress: 0,
    is_template: false,
    archived: false,
    created_at: new Date().toISOString(),
  };
  const { data: proj, error: projErr } = await supabase.from("projects").insert(insertRow).select().single();
  if (projErr || !proj) return { error: projErr || new Error("Clone failed") };

  if (copyTasks) {
    const { data: srcTasks } = await supabase.from("developer_tasks").select("*").eq("project_id", sourceProjectId);
    const rows = (srcTasks || []).map((t) => {
      const { id: _i, created_at: _c, updated_at: _u, submitted_at, reviewed_at, reviewed_by,
        actual_completion_date, admin_comments, rejection_reason, is_on_time, productivity_points,
        ...keep } = t;
      return {
        ...keep,
        organization_id: orgId,
        project_id: proj.id,
        status: "pending",
        start_date: t.start_date || today,
        end_date: t.end_date || today,
        created_at: new Date().toISOString(),
      };
    });
    if (rows.length) await supabase.from("developer_tasks").insert(rows);
  }
  await logActivity({ projectId: proj.id, entityType: "project", entityId: proj.id, action: "created", meta: { clonedFrom: sourceProjectId, name: insertRow.name } });
  return { project: proj, error: null };
}

// ---- Project health (derived, no I/O) -------------------------------------
// Computes progress %, counts and a simple risk flag from a task array + project.
export function computeProjectHealth(project, tasks) {
  const list = tasks || [];
  const total = list.length;
  const done = list.filter((t) => DONE_STATUSES.has(t.status)).length;
  const inProgress = list.filter((t) => t.status === "in_progress").length;
  const today = ymd(new Date());
  const overdue = list.filter(
    (t) => !DONE_STATUSES.has(t.status) && (t.due_date || t.end_date) && ymd(t.due_date || t.end_date) < today
  ).length;
  const progress = total ? Math.round((done / total) * 100) : (project?.progress || 0);
  const deadline = project?.end_date || project?.deadline || null;
  const deadlinePassed = deadline ? ymd(deadline) < today && progress < 100 : false;
  // risk: overdue tasks, or deadline passed while incomplete
  const risk = deadlinePassed || overdue > 0 ? (deadlinePassed || overdue > 2 ? "high" : "medium") : "low";
  return { total, done, inProgress, overdue, progress, deadline, deadlinePassed, risk };
}

// Upload a task attachment to the private `task-submissions` bucket (already used
// for proof-of-work) under a pm/ prefix, and record it.
export async function uploadTaskAttachment(taskId, file) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  const clean = file.name.replace(/[^a-zA-Z0-9.\-]/g, "_");
  const path = `pm/${orgId}/${taskId}/${Date.now()}_${clean}`;
  const { error: upErr } = await supabase.storage
    .from("task-submissions")
    .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("task_attachments")
    .insert({
      organization_id: orgId,
      task_id: taskId,
      file_name: file.name,
      file_path: path,
      file_type: file.type || null,
      file_size: file.size || null,
      uploaded_by: ctx?.userId || null,
    })
    .select()
    .single();
  return { attachment: data, error };
}
