import { authFetch } from "@/utils/authFetch";

/**
 * The submission guard for a re-saved task plan.
 *
 * WHAT IT PROTECTS
 *  src/app/developer/project-details/page.jsx replaces a project's still-pending
 *  developer_tasks when a plan is re-saved. developer_tasks cascades, so
 *  deleting a task takes its task_submissions row — the uploaded file, the
 *  submission note, the admin's review comments — with it. The guard exists so
 *  that a task which already carries a submission is never in the delete set.
 *
 * WHY IT CANNOT BE A BROWSER-SIDE SELECT
 *  It used to read task_submissions through the anon-key client under the
 *  caller's own session, with no developer filter, relying on RLS to hand back
 *  every relevant row. Migration 047 narrowed that table to per-person:
 *  owner/admin/hr see the organisation, a manager or team_lead sees only their
 *  reporting subtree, everyone else sees only their own. So the moment a manager
 *  or team_lead re-planned on behalf of somebody outside their subtree the query
 *  returned NOTHING, the guard concluded no task had a submission, and the
 *  delete took work that did. 047's own "STILL OPEN" item (d) names this file's
 *  predecessor and says the real fix is that the guard must not be a
 *  browser-side select at all. This is that fix.
 *
 *  The check now goes through GET /api/task-submission, which authenticates the
 *  caller with getAuthedOrg(), scopes the query to their organisation, and runs
 *  it on the SERVICE-ROLE client. Service role bypasses RLS, so the answer is a
 *  fact about the rows rather than a projection of who is asking, and no future
 *  narrowing of any task_submissions policy can blind it again. No policy or
 *  migration was changed and the route's own rules are untouched — a developer
 *  caller is still forced to their own developer_id by the route, which for this
 *  guard is the same set they were already planning over.
 *
 * FAIL CLOSED
 *  This throws if it cannot get a trustworthy answer. That is the whole point:
 *  the previous code destructured `{ data }` off a failed query, got undefined,
 *  and deleted everything. An unanswerable guard must stop the re-plan, not wave
 *  it through.
 *
 * @param {string} projectId  the project whose plan is being replaced
 * @param {string[]} candidateIds  task ids the caller proposes to delete
 * @returns {Promise<Set<string>>} the subset of candidateIds that must be kept
 */
export async function taskIdsWithSubmissions(projectId, candidateIds) {
  const wanted = new Set(
    (candidateIds || []).filter((id) => id != null && id !== "").map((id) => String(id))
  );
  if (wanted.size === 0) return new Set();

  if (!projectId) {
    throw new Error("Cannot verify existing submissions without a project id.");
  }

  const res = await authFetch(
    `/api/task-submission?projectId=${encodeURIComponent(String(projectId))}`
  );
  const payload = await res.json().catch(() => ({}));

  if (!res.ok || payload?.success !== true || !Array.isArray(payload.submissions)) {
    throw new Error(payload?.error || "Could not verify existing task submissions.");
  }

  const kept = new Set();
  for (const submission of payload.submissions) {
    const taskId = submission?.task_id;
    if (taskId == null || taskId === "") continue;
    const key = String(taskId);
    if (wanted.has(key)) kept.add(key);
  }
  return kept;
}
