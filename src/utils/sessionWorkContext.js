// Names are resolved through the caller's RLS client, never copied into telemetry.
// Deleted or no-longer-visible work keeps its attribution without exposing names.
export function sessionWorkLabel(session) {
  if (!session?.project_id) return 'General tracking';
  const project = session.project_name || 'Project unavailable';
  return session.task_id ? `${project} · ${session.task_title || 'Task unavailable'}` : project;
}

export async function resolveSessionWorkContext(client, sessions) {
  const rows = sessions.map(row => ({ ...row, project_name: null, task_title: null }));
  const organizations = [...new Set(rows.filter(row => row.project_id && row.organization_id).map(row => row.organization_id))];
  await Promise.all(organizations.map(async org => {
    const scoped = rows.filter(row => row.organization_id === org);
    const projects = [...new Set(scoped.map(row => row.project_id).filter(Boolean))];
    const tasks = [...new Set(scoped.map(row => row.task_id).filter(Boolean))];
    async function read(table, columns, ids) {
      if (!ids.length) return [];
      try {
        const result = await client.from(table).select(columns).eq('organization_id', org).in('id', ids);
        return result.error ? [] : result.data || [];
      } catch { return []; }
    }
    const [projectRows, taskRows] = await Promise.all([
      read('projects', 'id,name,organization_id', projects),
      read('developer_tasks', 'id,task_title,project_id,organization_id', tasks),
    ]);
    for (const row of scoped) {
      row.project_name = projectRows.find(p => p.id === row.project_id && p.organization_id === org)?.name || null;
      row.task_title = taskRows.find(t => t.id === row.task_id && t.project_id === row.project_id && t.organization_id === org)?.task_title || null;
    }
  }));
  return rows;
}
