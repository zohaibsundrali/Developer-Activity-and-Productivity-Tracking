const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Resolve notification targets using the caller's RLS client, never service access. */
export function createBoardTaskLinkRequest(client, publish) {
  let generation = 0;
  return {
    cancel() { generation += 1; },
    async load(orgId, taskId, scope) {
      const ticket = ++generation;
      const send = value => { if (ticket === generation) publish({ scope, ...value }); };
      send({ loading: true });
      if (!orgId || !UUID.test(taskId || '')) { send({ loading: false, error: 'This task link is invalid or unavailable.' }); return; }
      try {
        const task = await client.from('developer_tasks').select('*').eq('organization_id', orgId).eq('id', taskId).maybeSingle();
        if (ticket !== generation) return;
        if (task.error) throw new Error('Could not load the linked task. Please retry.');
        if (!task.data?.project_id || String(task.data.id).toLowerCase() !== taskId.toLowerCase()) { send({ loading: false, error: 'This task is unavailable or you no longer have access.' }); return; }
        const project = await client.from('projects').select('id,name').eq('organization_id', orgId).eq('id', task.data.project_id).maybeSingle();
        if (project.error) throw new Error('Could not load the linked project. Please retry.');
        if (!project.data?.id || project.data.id !== task.data.project_id) { send({ loading: false, error: 'This task is unavailable or you no longer have access.' }); return; }
        send({ loading: false, task: task.data, project: project.data });
      } catch (error) {
        send({ loading: false, error: error.message?.startsWith('Could not load the linked') ? error.message : 'Could not load the linked task. Please retry.' });
      }
    },
  };
}
