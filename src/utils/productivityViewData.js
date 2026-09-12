export async function loadProductivityPermission(fetcher, current = () => true) {
  if (!current()) return null;
  const response = await fetcher('/api/me/permissions');
  const data = await response.json().catch(() => null);
  if (!current()) return null;
  if (!response.ok || !data?.success || data.overridesUnavailable || !Array.isArray(data.permissions)) throw new Error('Could not confirm productivity permissions. Please retry.');
  if (!data.permissions.includes('report.view')) throw new Error('You do not have permission to view team productivity.');
  return true;
}

export async function loadProductivityOptions(client, organizationId, current = () => true) {
  if (!organizationId) throw new Error('Your organization could not be confirmed. Sign in again.');
  async function read(table) {
    const rows = [];
    const seen = new Set();
    let total = null;
    while (true) {
      if (!current()) return null;
      const { data, count, error } = await client.from(table).select('id, name', { count: 'exact' })
        .eq('organization_id', organizationId).order('name').order('id')
        .range(rows.length, rows.length + 499);
      if (!current()) return null;
      if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0
        || data.length > 500 || (total !== null && count !== total)) throw new Error('Could not load complete productivity options. Please retry.');
      total = count;
      for (const row of data) {
        if (typeof row?.id !== 'string' || !row.id || seen.has(row.id)) throw new Error('Productivity options changed while loading. Please retry.');
        seen.add(row.id);
        rows.push({ id: row.id, name: row.name || 'Unnamed' });
      }
      if (rows.length > total || (!data.length && rows.length !== total)) throw new Error('Productivity options changed while loading. Please retry.');
      if (rows.length === total) return rows;
    }
  }
  const [developers, projects] = await Promise.all([read('developers'), read('projects')]);
  return current() && developers && projects ? { developers, projects } : null;
}

export function productivityQuery(view, developerId, projectId, options) {
  if (view === 'overall') return '/api/productivity?type=overall';
  if ((view === 'developer' && !developerId) || (view === 'project' && !projectId)) return null;
  if (developerId && !options.developers.some(row => row.id === developerId)) throw new Error('This developer is no longer available. Refresh and choose again.');
  if (view === 'project' && !options.projects.some(row => row.id === projectId)) throw new Error('This project is no longer available. Refresh and choose again.');
  const query = new URLSearchParams({ type: view });
  if (developerId) query.set('developerId', developerId);
  if (view === 'project') query.set('projectId', projectId);
  return `/api/productivity?${query}`;
}

export async function loadProductivityView(fetcher, url, current = () => true, organizationId = null) {
  if (!url || !current()) return null;
  const response = await fetcher(url);
  const data = await response.json().catch(() => null);
  if (!current()) return null;
  if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not load productivity data. Please retry.');
  if (organizationId && data.orgId !== organizationId) throw new Error('Could not confirm the productivity organization. Please retry.');
  const query = new URL(url, 'https://local.invalid').searchParams;
  const view = query.get('type');
  if ((view === 'developer' && data.developerId !== query.get('developerId'))
    || (view === 'project' && data.projectId !== query.get('projectId'))
    || (view === 'overall' && !Array.isArray(data.developersBreakdown))) throw new Error('Could not confirm the selected productivity result. Please retry.');
  return data;
}

export function projectProductivityUrl(projectId, developerId = null) {
  const query = new URLSearchParams({ type: 'project', projectId });
  if (developerId) query.set('developerId', developerId);
  return `/api/productivity?${query}`;
}

export function createProductivityRequestGate() {
  let generation = 0;
  return {
    begin(current) { const ticket = ++generation; return () => ticket === generation && current(); },
    invalidate() { generation += 1; },
  };
}
