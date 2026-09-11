import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ logs: [], logError: null, calls: [], token: null }));
const org = 'org';
const reviewer = '81000000-0000-0000-0000-000000000001';
const developer = '81000000-0000-0000-0000-000000000002';
function query(client, table) {
  const filters = {};
  const q = { select: () => q, eq: (k,v) => { filters[k]=v; return q; }, or: () => q,
    in: () => q, order: () => q, limit: () => q,
    then: resolve => {
      state.calls.push({ client, table, filters });
      let result = { data: [] };
      if (client === 'service' && table === 'projects') result = { data: [{ id: 'project' }] };
      if (client === 'service' && table === 'task_submissions') result = { data: [{ id: 'submission', project_id: 'project', developer_id: developer }], count: 1 };
      if (table === 'activity_logs') result = client === 'service' ? { data: [{ id: 'private-log' }] } : { data: state.logs, error: state.logError };
      return Promise.resolve(result).then(resolve);
    } };
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: table => query('service', table) }) }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => ({ orgId: org, appUserId: reviewer, userType: 'developer', role: 'qa', token: 'reviewer-token', overrides: {} }),
  serviceClient: () => ({ rpc: async () => ({ data: true }) }),
  orgScopedClient: token => { state.token=token; return { from: table => query('authenticated', table) }; },
}));
import { GET } from '@/app/api/admin-review/route';
beforeEach(() => { state.logs=[]; state.logError=null; state.calls=[]; state.token=null; });
async function getReview() {
  const response=await GET(new Request('http://localhost/api/admin-review'));
  expect(response.status).toBe(200);
  return (await response.json()).reviews[0];
}
it('does not expose service-visible logs when reviewer RLS returns no rows', async () => {
  expect((await getReview()).activityLogs).toEqual([]);
  expect(state.token).toBe('reviewer-token');
  expect(state.calls.filter(c => c.table === 'activity_logs')).toEqual([{ client: 'authenticated', table: 'activity_logs', filters: { organization_id: org, developer_id: developer, project_id: 'project' } }]);
});
it('preserves logs that the reviewer is authorized to read', async () => {
  state.logs=[{ id: 'allowed-log' }];
  expect((await getReview()).activityLogs).toEqual(state.logs);
});
it('does not fall back to service reads or fail review loading on monitoring errors', async () => {
  state.logs=[{ id: 'partial-private-log' }]; state.logError={ message: 'database detail' };
  expect((await getReview()).activityLogs).toEqual([]);
  expect(state.calls.some(c => c.table === 'activity_logs' && c.client === 'service')).toBe(false);
});
