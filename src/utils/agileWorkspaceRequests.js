export function createAgileRequest() {
  let generation = 0;
  return {
    cancel() { generation += 1; },
    async run({ load, isCurrent, onStart, onResult, onError }) {
      const ticket = ++generation;
      onStart();
      try {
        const result = await load();
        if (ticket !== generation || !isCurrent()) return;
        onResult(result);
      } catch (error) {
        if (ticket !== generation || !isCurrent()) return;
        onError(error);
        throw error;
      }
    },
  };
}

export async function loadAgileProjects(client, orgId) {
  if (!orgId) throw new Error('Your organization could not be verified. Sign in again.');
  const query = archived => {
    let q = client.from('projects').select('id, name').eq('organization_id', orgId);
    if (archived) q = q.eq('archived', false);
    return q.order('created_at', { ascending: false });
  };
  let result = await query(true);
  if (result.error && ['42703', 'PGRST204'].includes(result.error.code) && /archived/i.test(result.error.message || '')) result = await query(false);
  if (result.error) throw result.error;
  return result.data || [];
}
