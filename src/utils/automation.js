import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { isTransitionAllowed, REVIEW_ONLY_STATUSES } from "@/utils/pmData";

/**
 * Workflow automation engine (ClickUp/Jira style).
 *
 * Rules live in `automation_rules` (016): { trigger jsonb, actions jsonb }.
 * The engine runs CLIENT-SIDE right after a task mutation, under the signed-in
 * user's JWT, so every write it performs is still RLS-scoped — an automation can
 * never touch data its author couldn't touch by hand.
 *
 * Loop safety: actions write to developer_tasks with a plain supabase update
 * (never via changeTaskStatus/updateTask), so an automation can't re-trigger
 * automations. `set_status` still checks the transition rules before writing.
 * Every failure is swallowed and reported through the returned `errors` array —
 * automation must never break the user's actual task edit.
 */

export const TRIGGER_EVENTS = [
  { id: "task_created", label: "Task is created" },
  { id: "status_changed", label: "Status changes" },
  { id: "assigned", label: "Task is assigned" },
  { id: "priority_changed", label: "Priority changes" },
];

export const ACTION_TYPES = [
  { id: "assign", label: "Assign to person" },
  { id: "set_status", label: "Set status" },
  { id: "set_priority", label: "Set priority" },
  { id: "add_label", label: "Add label" },
  { id: "notify", label: "Send notification" },
  { id: "email", label: "Send email" },
];

// ---- rules CRUD ----------------------------------------------------------
export async function loadRules(projectId) {
  const orgId = getOrgId();
  if (!orgId) return [];
  let q = supabase
    .from("automation_rules")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
}

export async function saveRule(projectId, patch) {
  const orgId = getOrgId();
  const ctx = getOrgContext();
  if (patch.id) {
    const { id, ...rest } = patch;
    const { error } = await supabase.from("automation_rules").update(rest).eq("id", id);
    return { error };
  }
  const { data, error } = await supabase
    .from("automation_rules")
    .insert({
      organization_id: orgId,
      project_id: projectId || null,
      created_by: ctx?.userId || null,
      enabled: true,
      trigger: {},
      actions: [],
      ...patch,
    })
    .select()
    .single();
  return { rule: data, error };
}

export async function deleteRule(id) {
  const { error } = await supabase.from("automation_rules").delete().eq("id", id);
  return { error };
}

export async function toggleRule(id, enabled) {
  const { error } = await supabase.from("automation_rules").update({ enabled: !!enabled }).eq("id", id);
  return { error };
}

// ---- matching ------------------------------------------------------------
/**
 * Does `rule.trigger` match this event?
 * ctx = { event, task, prev }  (prev = the row before the change, when known)
 */
export function ruleMatches(rule, ctx) {
  const t = rule?.trigger || {};
  if (!rule?.enabled) return false;
  if (!t.event || t.event !== ctx.event) return false;

  const task = ctx.task || {};

  // Optional narrowing filters — an unset filter means "any".
  if (t.taskType && (task.task_type || "feature") !== t.taskType) return false;
  if (t.priority && (task.priority || "medium") !== t.priority) return false;

  if (t.event === "status_changed") {
    if (t.to && task.status !== t.to) return false;
    if (t.from && (ctx.prev?.status ?? null) !== t.from) return false;
  }
  if (t.event === "priority_changed" && t.toPriority) {
    if ((task.priority || "medium") !== t.toPriority) return false;
  }
  return true;
}

// ---- action execution ----------------------------------------------------
async function applyAction(action, ctx, errors) {
  const orgId = getOrgId();
  const task = ctx.task || {};
  const taskId = task.id;
  if (!taskId) return;

  try {
    switch (action.type) {
      case "assign": {
        if (!action.userId) return;
        const { error } = await supabase
          .from("developer_tasks")
          .update({ developer_id: action.userId, updated_at: new Date().toISOString() })
          .eq("id", taskId);
        if (error) throw error;
        break;
      }
      case "set_status": {
        if (!action.status || action.status === task.status) return;
        // The same transition rules the boards obey. An automation that wrote
        // `completed`/`rejected` straight to the column would close work with no
        // submission, no review record and no productivity points.
        if (!isTransitionAllowed(task.status, action.status)) {
          throw new Error(
            `Refused status change ${task.status || "pending"} → ${action.status}` +
              (REVIEW_ONLY_STATUSES.has(action.status) ? " (decided in review)" : "")
          );
        }
        const { error } = await supabase
          .from("developer_tasks")
          .update({ status: action.status, updated_at: new Date().toISOString() })
          .eq("id", taskId);
        if (error) throw error;
        break;
      }
      case "set_priority": {
        if (!action.priority) return;
        const { error } = await supabase
          .from("developer_tasks")
          .update({ priority: action.priority, updated_at: new Date().toISOString() })
          .eq("id", taskId);
        if (error) throw error;
        break;
      }
      case "add_label": {
        if (!action.label) return;
        const current = Array.isArray(task.labels) ? task.labels : [];
        if (current.includes(action.label)) return;
        const { error } = await supabase
          .from("developer_tasks")
          .update({ labels: [...current, action.label], updated_at: new Date().toISOString() })
          .eq("id", taskId);
        if (error) throw error;
        break;
      }
      case "notify": {
        const target = resolveRecipient(action, task);
        if (!target) return;
        const { error } = await supabase.from("notifications").insert({
          organization_id: orgId,
          developer_id: target,
          type: "automation",
          title: action.title || "Workflow automation",
          message: action.message || `Task "${task.task_title || "Untitled"}" was updated by an automation.`,
          project_id: task.project_id || null,
          task_id: taskId,
        });
        if (error) throw error;
        break;
      }
      case "email": {
        const target = resolveRecipient(action, task);
        if (!target) return;
        // Email must be sent server-side (nodemailer); the route re-checks that
        // the recipient belongs to the caller's org before sending.
        const res = await authFetch("/api/automation/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userIds: [target],
            taskId,
            subject: action.subject || "Task update",
            message: action.message || `Task "${task.task_title || "Untitled"}" was updated.`,
            sendEmail: true,
          }),
        });
        if (!res.ok) throw new Error(`Email route returned ${res.status}`);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    errors.push({ action: action.type, message: err?.message || String(err) });
  }
}

function resolveRecipient(action, task) {
  if (action.target === "user") return action.userId || null;
  // default: the task's assignee
  return task.developer_id || action.userId || null;
}

// ---- entry point ---------------------------------------------------------
/**
 * Run all matching rules for an event. Always resolves (never throws) so a
 * failing automation can't break the user's task edit.
 * Returns { ran: number, errors: [] }.
 */
export async function runAutomations({ event, task, prev, projectId }) {
  const result = { ran: 0, errors: [] };
  try {
    if (!task?.id) return result;
    const orgId = getOrgId();
    if (!orgId) return result;

    const pid = projectId || task.project_id || null;
    // Rules scoped to this project OR org-wide (project_id null).
    const { data } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("organization_id", orgId)
      .eq("enabled", true);
    const rules = (data || []).filter((r) => !r.project_id || r.project_id === pid);
    if (!rules.length) return result;

    const ctx = { event, task, prev };
    for (const rule of rules) {
      if (!ruleMatches(rule, ctx)) continue;
      const actions = Array.isArray(rule.actions) ? rule.actions : [];
      for (const action of actions) {
        await applyAction(action, ctx, result.errors);
      }
      result.ran += 1;

      // Record that the rule fired (best-effort).
      try {
        await supabase.from("pm_activity").insert({
          organization_id: orgId,
          project_id: pid,
          entity_type: "task",
          entity_id: task.id,
          action: "automation_ran",
          meta: { rule: rule.name, event },
        });
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    result.errors.push({ action: "engine", message: err?.message || String(err) });
  }
  return result;
}
