export async function writeMilestone(client, orgId, projectId, patch, remove = false) {
  if (!orgId || (!remove && !projectId) || !patch || typeof patch !== 'object') return { error: new Error('A milestone and organization are required.') };
  const { id, ...input } = patch;
  const allowed = new Set(['title', 'description', 'due_date', 'status', 'sort_order', 'client_visible']);
  const values = {};
  for (const [key,value] of Object.entries(input)) {
    if (!allowed.has(key)) return { error: new Error('Unsupported milestone field.') };
    if (value !== undefined) values[key] = value;
  }
  if ('title' in values && (typeof values.title !== 'string' || !values.title.trim())) return { error: new Error('Milestone title is required.') };
  if ('title' in values) values.title = values.title.trim();
  if ('status' in values && !['pending','in_progress','completed'].includes(values.status)) return { error: new Error('Invalid milestone status.') };
  if (remove && !id) return { error: new Error('Select a milestone to delete.') };
  let query = client.from('milestones');
  if (remove) query = query.delete();
  else if (id) query = query.update({ ...values, updated_at: new Date().toISOString() });
  else query = query.insert({ ...values, organization_id: orgId, project_id: projectId });
  if (id) query = query.eq('id',id).eq('organization_id',orgId);
  if (id && projectId) query = query.eq('project_id',projectId);
  const { data,error } = await query.select('*').maybeSingle();
  if (error) return { error };
  if (!data?.id) return { error: new Error('Nothing was saved. The milestone may have changed or your access was removed. Reload and retry.') };
  return { milestone: data,error:null };
}
