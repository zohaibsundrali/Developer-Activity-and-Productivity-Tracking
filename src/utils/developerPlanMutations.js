const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Temporary client IDs are not database identities. Retained task IDs let the
// transaction update existing tasks without duplicating their linked records.
export function persistedPlanTaskId(task) {
  const id = task?.supabaseId || task?.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

export function taskPlanPayload(task) {
  const id = persistedPlanTaskId(task);
  return {
    ...(id ? { id } : {}),
    task_title: task.title,
    task_description: task.description || '',
    start_date: task.startDate,
    end_date: task.endDate,
  };
}

// PostgREST can report success with zero affected rows after an RLS refusal.
// Only reflect a mutation in the UI when the requested row was returned.
export async function requireTaskMutation(query, taskId) {
  const { data, error } = await query.select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== taskId) {
    throw new Error('Task was not changed. Refresh the page and check your access.');
  }
}
