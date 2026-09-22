import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queries: [], results: {} }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: {
  from(table) {
    const query = { table, filters: [] };
    state.queries.push(query);
    const builder = {};
    for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'contains']) {
      builder[method] = (...args) => { query.filters.push([method, ...args]); return builder; };
    }
    builder.then = (fn) => Promise.resolve(state.results[table] || { data: [], count: 0 }).then(fn);
    return builder;
  },
} }));
vi.mock('@/utils/orgWorkGraph', async importOriginal => ({
  ...await importOriginal(),
  loadOrgWorkGraph: vi.fn(async () => ({ projects: [], tasks: [], people: [] })),
}));
import { loadAdminOverview, overviewKpis, OWNER_KPI_KEYS } from '@/utils/adminOverview';

beforeEach(() => { state.queries = []; state.results = {}; });

describe('owner dashboard counts', () => {
  it('uses exact organization-scoped counts and actionable request statuses', async () => {
    state.results.clients = { count: 1500 };
    state.results.change_requests = { count: 27 };
    state.results.leave_requests = { count: 8 };
    const result = await loadAdminOverview('org-a', { withClients: true, withChangeRequests: true, withLeaveRequests: true });
    expect(overviewKpis(result)).toMatchObject({ clientCount: 1500, changeRequestCount: 27, leaveRequestCount: 8 });
    for (const table of ['clients', 'change_requests', 'leave_requests']) {
      const query = state.queries.find(q => q.table === table);
      expect(query.filters).toContainEqual(['eq', 'organization_id', 'org-a']);
      expect(query.filters).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
    }
    expect(state.queries.find(q => q.table === 'change_requests').filters)
      .toContainEqual(['in', 'status', ['submitted', 'estimating', 'awaiting_admin', 'approved']]);
    expect(state.queries.find(q => q.table === 'leave_requests').filters).toContainEqual(['eq', 'status', 'pending']);
  });

  it('does not query queues a viewer cannot access', async () => {
    await loadAdminOverview('org-a');
    expect(state.queries.map(q => q.table)).not.toEqual(expect.arrayContaining(['clients', 'change_requests', 'leave_requests']));
    for (const table of ['clients', 'change_requests', 'leave_requests']) expect(state.queries.some(q => q.table === table)).toBe(false);
  });

  it('reads updated values again on refresh and surfaces errors instead of reporting zero', async () => {
    state.results.leave_requests = { count: 8 };
    expect((await loadAdminOverview('org-a', { withLeaveRequests: true })).leaveRequestCount).toBe(8);
    state.results.leave_requests = { count: 3 };
    expect((await loadAdminOverview('org-a', { withLeaveRequests: true })).leaveRequestCount).toBe(3);
    state.results.leave_requests = { error: { message: 'Unavailable' }, count: null };
    await expect(loadAdminOverview('org-a', { withLeaveRequests: true })).rejects.toThrow('counts could not be loaded');
  });

  it('includes the requested owner metrics without crowding out operational queues', () => {
    expect(OWNER_KPI_KEYS).toHaveLength(12);
    expect(OWNER_KPI_KEYS).toEqual(expect.arrayContaining(['clientCount', 'changeRequestCount', 'leaveRequestCount', 'organizationCount', 'pendingReviews', 'openBugs']));
  });
});
