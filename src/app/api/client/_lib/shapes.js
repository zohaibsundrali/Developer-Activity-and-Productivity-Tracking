// Shared response shapes for the Client Portal 2.0 routes.
//
// docs/client-portal-v2-contract.md is the contract; this file is the single
// implementation of the parts of it that more than one route has to produce.
// `progress` / `health` are returned by both /api/client/projects and
// /api/client/projects/[id], and a ClientApproval is returned by both approval
// routes — two routes computing them slightly differently is exactly the drift
// the contract exists to prevent, so they are computed here once.
//
// Nothing in this file touches the database or the request. It takes rows that
// a route has already fetched inside a verified org + project scope, and maps
// them to the contract shape, dropping every field the contract does not name.

const DONE_TASK_STATUSES = new Set(["completed"]);
// A rejected task is closed, not open: it is not work the client is waiting on.
const CLOSED_TASK_STATUSES = new Set(["completed", "rejected"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const AT_RISK_WINDOW_DAYS = 7;
const AT_RISK_PROGRESS = 75;

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Tasks still open, from the client-visible set the caller passed in.
export function countOpenTasks(tasks) {
  return (tasks || []).filter((t) => !CLOSED_TASK_STATUSES.has(t?.status)).length;
}

// Contract: `progress` is 0-100 computed from client-visible tasks. When a
// project has no client-visible task at all there is nothing to compute from,
// so the project's own stored progress is used rather than reporting a
// misleading 0% on a project that is genuinely under way.
export function computeProgress(tasks, storedProgress) {
  const list = tasks || [];
  if (!list.length) return clampPercent(storedProgress);
  const done = list.filter((t) => DONE_TASK_STATUSES.has(t?.status)).length;
  return clampPercent((done / list.length) * 100);
}

// Contract: `overdue` when the deadline has passed and progress < 100;
// `at_risk` when the deadline is within 7 days and progress < 75; else
// `on_track`. A project with no deadline can be neither late nor nearly late.
export function deriveHealth(deadline, progress) {
  if (!deadline) return "on_track";
  const due = Date.parse(deadline);
  if (Number.isNaN(due)) return "on_track";

  const now = Date.now();
  if (due < now && progress < 100) return "overdue";
  if (due - now <= AT_RISK_WINDOW_DAYS * DAY_MS && progress < AT_RISK_PROGRESS) {
    return "at_risk";
  }
  return "on_track";
}

// ClientProjectSummary. `tasks` must already be filtered to client_visible
// rows and `pendingApprovals` counted inside the client's project scope.
export function buildProjectSummary({ project, tasks, pendingApprovals }) {
  const progress = computeProgress(tasks, project?.progress);
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    progress,
    deadline: project.deadline || null,
    health: deriveHealth(project.deadline, progress),
    open_tasks: countOpenTasks(tasks),
    pending_approvals: pendingApprovals || 0,
  };
}

// The `history` of a ClientApproval, newest first. Only the five contract
// fields — actor ids and the org id stay server-side.
export function buildApprovalHistory(events) {
  return (events || []).map((e) => ({
    id: e.id,
    action: e.action,
    note: e.note || null,
    actor_name: e.actor_name || null,
    created_at: e.created_at,
  }));
}

// ClientApproval. `decided_by`, `item_ref` and the raw note column are
// deliberately not returned: the contract lists neither, and the decision trail
// is exposed through `history` instead.
export function buildApproval({ approval, projectName, events }) {
  return {
    id: approval.id,
    project_id: approval.project_id,
    project_name: projectName || null,
    title: approval.title,
    description: approval.description || null,
    item_type: approval.item_type,
    status: approval.status,
    created_at: approval.created_at,
    history: buildApprovalHistory(events),
  };
}
