import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { processPendingAutomations } from "@/utils/automationDispatch";

/** Rule editing remains caller-RLS scoped. Actual task events are captured
 * transactionally and executed server-side using the triggering actor's JWT.
 * Failed work survives reload; processing resumes on the next signed-in session.
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

// ---- durable authenticated dispatch -------------------------------------
// Actual OLD/NEW events are captured by the database. Browser callbacks merely
// wake the server processor; they never supply event snapshots or execute rules.
export async function runAutomations() {
  return processPendingAutomations({ force: true });
}
