import { describe, expect, it, vi } from 'vitest';
import { loadClientProjectScope } from '@/utils/clientProjectScope';
function fixture(length, cap = 500, change = value => value) {
  const rows = Array.from({ length }, (_, i) => ({ project_id: `project-${i}`, client_id: 'client', organization_id: 'org' }));
  const queries = [];
  const svc = { from: vi.fn(table => {
    const q = { table, filters: [], select: vi.fn().mockReturnThis(), eq: vi.fn((...args) => { q.filters.push(args); return q; }), order: vi.fn().mockReturnThis(), range: vi.fn(async (start, end) => change({ data: rows.slice(start, Math.min(end + 1, start + cap)), count: rows.length, error: null }, start)) };
    queries.push(q); return q;
  }) };
  return { svc, queries, rows };
}
const identity = { clientId: 'client', orgId: 'org' };
describe('complete client project authorization scope', () => {
  it.each([0, 1, 500, 1001, 1501])('loads all %i links with deterministic scoped pages', async count => {
    const { svc, queries } = fixture(count);
    expect(await loadClientProjectScope(svc, identity)).toHaveLength(count);
    for (const q of queries) {
      expect(q.table).toBe('project_clients');
      expect(q.filters).toEqual([['client_id', 'client'], ['organization_id', 'org']]);
      expect(q.order).toHaveBeenCalledWith('project_id', { ascending: true });
      expect(q.select).toHaveBeenCalledWith('project_id,client_id,organization_id', { count: 'exact' });
    }
  });
  it('continues when the configured server row cap is smaller than the requested page', async () => {
    const { svc } = fixture(901, 100);
    expect(await loadClientProjectScope(svc, identity)).toHaveLength(901);
  });
  it.each([
    result => ({ ...result, error: { message: 'private detail' } }),
    result => ({ ...result, count: null }),
    result => ({ ...result, data: null }),
    result => ({ ...result, data: [] }),
    result => ({ ...result, data: [{ ...result.data[0], client_id: 'other' }] }),
    result => ({ ...result, data: [{ ...result.data[0], organization_id: 'other' }] }),
    result => ({ ...result, data: [{ ...result.data[0], project_id: null }] }),
    result => ({ ...result, count: 0 }),
  ])('refuses incomplete or invalid authorization data', async change => {
    const { svc } = fixture(1, 500, change);
    await expect(loadClientProjectScope(svc, identity)).rejects.toThrow('Project access verification unavailable.');
  });
  it('refuses a changing count instead of silently returning partial access', async () => {
    const { svc } = fixture(501, 500, (result, start) => start ? { ...result, count: 502 } : result);
    await expect(loadClientProjectScope(svc, identity)).rejects.toThrow();
  });
  it('rejects repeated pages instead of looping indefinitely', async () => {
    const { svc } = fixture(501, 500, (result, start) => start ? { ...result, data: [{ project_id: 'project-0', client_id: 'client', organization_id: 'org' }] } : result);
    await expect(loadClientProjectScope(svc, identity)).rejects.toThrow();
  });
});
