/** Resolve every client-project link without treating a REST row cap as the end. */
export async function loadClientProjectScope(svc, { clientId, orgId }) {
  if (!clientId || !orgId) throw new Error('Project access verification unavailable.');
  const projectIds = new Set();
  let total;
  for (;;) {
    const { data, error, count } = await svc.from('project_clients')
      .select('project_id,client_id,organization_id', { count: 'exact' })
      .eq('client_id', clientId).eq('organization_id', orgId)
      .order('project_id', { ascending: true })
      .range(projectIds.size, projectIds.size + 499);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 ||
        (total !== undefined && total !== count)) throw new Error('Project access verification unavailable.');
    total = count;
    for (const row of data) {
      if (!row || typeof row.project_id !== 'string' || !row.project_id ||
          row.client_id !== clientId || row.organization_id !== orgId || projectIds.has(row.project_id)) {
        throw new Error('Project access verification unavailable.');
      }
      projectIds.add(row.project_id);
    }
    if (projectIds.size === total) return [...projectIds];
    if (!data.length || projectIds.size > total) throw new Error('Project access verification unavailable.');
  }
}
