/** Load the caller's staffed and legacy assignments through their RLS client. */
export async function loadDashboardOwnProjects(client, { organizationId, userId, userType }) {
  if (!organizationId || !userId || !['admin', 'developer'].includes(userType)) {
    throw new Error('Your project identity could not be verified. Please sign in again.');
  }
  async function allRows(query) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await query().range(offset, offset + 499);
      if (error || !Array.isArray(data)) throw new Error('Could not load your projects. Please retry.');
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }
  const members = await allRows(() => client.from('project_members').select('project_id')
    .eq('organization_id', organizationId).eq('user_id', userId).eq('user_type', userType).order('id'));
  const projects = new Map();
  // Only developer profiles can be the legacy developer assignee. UUIDs in
  // admin_users and developers are independent identity domains.
  if (userType === 'developer') {
    const legacy = await allRows(() => client.from('projects').select('*')
      .eq('organization_id', organizationId).eq('assigned_developer_id', userId).order('id'));
    legacy.forEach(row => projects.set(row.id, row));
  }
  const ids = [...new Set(members.map(row => row.project_id).filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const rows = await allRows(() => client.from('projects').select('*')
      .eq('organization_id', organizationId).in('id', batch).order('id'));
    rows.forEach(row => projects.set(row.id, row));
  }
  return [...projects.values()].sort((a, b) =>
    (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}
