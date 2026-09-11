// Copy project configuration without transferring identity, approval, score,
// completion, client acceptance or closure history to a new project.
export function projectCloneFields(source) {
  const omitted = new Set([
    'id', 'created_at', 'updated_at', 'name', 'status', 'progress',
    'total_tasks_count', 'completed_tasks_count', 'total_productivity_score',
    'task_plan_submitted', 'task_plan_status', 'task_plan_submitted_at',
    'task_plan_reviewed_at', 'task_plan_reviewed_by', 'task_plan_rejection_reason',
    'completed_at', 'completed_by', 'client_signed_off_at', 'client_rating',
    'client_feedback', 'closed_at', 'closed_by', 'closure_note',
  ]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => !omitted.has(key)));
}
