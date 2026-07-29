import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";

/**
 * Data access for the Enterprise Project Management module.
 *
 * Extends the existing developer_tasks / projects model (never replaces it) and
 * the new PM tables from migration 016. Everything is org-scoped and uses the
 * logged-in user's JWT (RLS permits non-clients, denies clients).
 */

// The existing task status pipeline doubles as default Kanban columns.
export const BOARD_COLUMNS = [
  { id: "pending", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "awaiting_approval", label: "In Review" },
  { id: "completed", label: "Done" },
];

export const PRIORITIES = ["low", "medium", "high", "urgent"];

// Task types (017). 'story' = a Jira-style user story (usually under an epic).
export const TASK_TYPES = ["feature", "bug", "improvement", "research", "documentation", "story"];

export const SPRINT_STATUS = ["planned", "active", "completed"];

// ---- Tasks -----------------------------------------------------------
export async function loadTasks(projectId) {
  let q = supabase
    .from("developer_tasks")
    .select("*")
    .order("position", { ascending: true, nullsFirst: false })
    .order("task_order", { ascending: true });
  if (projectId) q = q.eq("project_id", projectId);
  else {
    const orgId = getOrgId();
    if (orgId) q = q.eq("organization_id", orgId);
  }
  const { data, error } = await q;
  return { tasks: data || [], error };
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
  const { data, error } = await supabase.from("developer_tasks").insert(row).select().single();
  return { task: data, error };
}

export async function updateTask(taskId, patch) {
  const { error } = await supabase
    .from("developer_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  return { error };
}

// Move a task to a new status column / position (Kanban drag-drop).
export async function moveTask(taskId, { status, position }) {
  return updateTask(taskId, { status, position });
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
export async function assignTaskToSprint(taskId, sprintId) {
  return updateTask(taskId, { sprint_id: sprintId || null });
}
export async function setTaskEpic(taskId, epicId) {
  return updateTask(taskId, { epic_id: epicId || null });
}
export async function setTaskType(taskId, taskType) {
  return updateTask(taskId, { task_type: taskType || "feature" });
}
export async function setStoryPoints(taskId, points) {
  const n = points === "" || points == null ? null : Number(points);
  return updateTask(taskId, { story_points: Number.isNaN(n) ? null : n });
}

// Move a sprint through planned → active → completed.
export async function setSprintStatus(sprintId, status) {
  const { error } = await supabase.from("sprints").update({ status }).eq("id", sprintId);
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
