const fields = {
  sprints: ['name', 'goal', 'status', 'start_date', 'end_date', 'sort_order'],
  epics: ['name', 'description', 'color', 'status'],
};
const statuses = { sprints: ['planned', 'active', 'completed'], epics: ['open', 'in_progress', 'done'] };
function dateValue(value) {
  if (value === '' || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a valid calendar date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Use a valid calendar date.');
  return value;
}
export function planningPatch(table, patch) {
  if (!fields[table] || !patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid planning record.');
  const clean = {};
  for (const key of Object.keys(patch)) {
    if (key === 'id') continue;
    if (!fields[table].includes(key)) throw new Error(`Cannot change planning field: ${key}`);
    const value = patch[key];
    if (key === 'name') {
      if (typeof value !== 'string' || !value.trim()) throw new Error('A name is required.');
      clean.name = value.trim();
    } else if (key === 'status') {
      if (!statuses[table].includes(value)) throw new Error('Invalid status.');
      clean.status = value;
    } else if (key.endsWith('_date')) clean[key] = dateValue(value);
    else if (key === 'sort_order') {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('Sort order must be a whole number.');
      clean[key] = value;
    } else {
      if (value !== null && typeof value !== 'string') throw new Error(`Invalid ${key}.`);
      clean[key] = value;
    }
  }
  if (!patch.id && !clean.name) throw new Error('A name is required.');
  if (clean.start_date && clean.end_date && clean.end_date < clean.start_date) throw new Error('End date must not be before start date.');
  return clean;
}
export async function savePlanningRecord(client, orgId, table, projectId, patch) {
  try {
    if (!orgId) throw new Error('Your organization could not be verified. Please sign in again.');
    const clean = planningPatch(table, patch);
    let query;
    if (patch.id) {
      query = client.from(table).update(clean).eq('organization_id', orgId).eq('id', patch.id);
      // undefined is used only for a status update by ID; explicit null means a global container.
      if (projectId !== undefined) query = projectId === null ? query.is('project_id', null) : query.eq('project_id', projectId);
    } else query = client.from(table).insert({ ...clean, organization_id: orgId, project_id: projectId || null });
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data?.id || (patch.id && data.id !== patch.id)) throw new Error('Nothing was saved. Refresh and check your access.');
    return { [table === 'sprints' ? 'sprint' : 'epic']: data, error: null };
  } catch (error) { return { error }; }
}
