import { describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/supabaseClient', () => ({ supabase: {} }));
import { loadReportDataForClient, teamProductivity, summaryKpis, projectPerformance } from '@/utils/reportsData';
const range = { from: '2026-09-01', to: '2026-09-12' };
const member = (i, type = 'developer') => ({ id: `m-${type}-${i}`, organization_id: 'org', user_id: `u-${i}`, user_type: type, role: type, email: `${type}${i}@example.test`, status: 'active' });
const session = (i, user = 'u-1') => ({ session_id: `s-${String(i).padStart(6, '0')}`, user_id: user, user_email: 'developer1@example.test', start_time: '2026-09-05T09:00:00Z', total_duration: 3600 });
function database(tables = {}, options = {}) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [], orders: [], columns: null, head: false }; calls.push(call);
    const q = {
      select: (columns, opts) => { call.columns = columns; call.head = Boolean(opts?.head); call.countRequested = opts?.count; return q; },
      order: (column, opts) => { call.orders.push([column, opts.ascending]); return q; },
      range: async (from, to) => { call.range = [from, to]; return read(from, to); },
      then: (resolve, reject) => Promise.resolve(read()).then(resolve, reject),
    };
    for (const method of ['eq', 'neq', 'in', 'gte', 'lte', 'lt']) q[method] = (key, value) => { call.filters.push([method, key, value]); return q; };
    function read(from = 0, to = 999) {
      if (options.fail?.(call)) return { data: null, error: { message: 'offline' } };
      let rows = (tables[table] || []).filter(row => call.filters.every(([op, key, value]) => {
        if (op === 'eq') return row[key] === value;
        if (op === 'neq') return row[key] !== value;
        if (op === 'in') return value.includes(row[key]);
        return op === 'gte' ? row[key] >= value : op === 'lt' ? row[key] < value : row[key] <= value;
      }));
      if (call.head) return { data: null, count: Object.hasOwn(options, 'count') ? options.count : rows.length, error: null };
      rows = [...rows].sort((a,b) => {
        for (const [key, ascending] of call.orders) { const cmp = String(a[key]).localeCompare(String(b[key])); if (cmp) return ascending ? cmp : -cmp; }
        return 0;
      });
      // PostgREST rejects a start offset beyond a nonempty result set.
      if (from > 0 && from >= rows.length) throw new Error('416 Requested range not satisfiable');
      const actualFrom = options.repeat?.(call) ? 0 : from;
      return { data: rows.slice(actualFrom, actualFrom + Math.min(to - from + 1, options.cap || 1000)), count: options.pagedCount ? options.pagedCount(call, rows.length) : rows.length, error: null };
    }
    return q;
  } };
  return { client, calls };
}
describe('report loader completeness', () => {
  it('loads every short hosted-capped page, including directory members and their sessions', async () => {
    const tables = {
      memberships: [member(1), member(2), member(3)],
      developers: [1,2,3].map(i => ({ id: `u-${i}`, organization_id: 'org', name: `Developer ${i}`, email: `developer${i}@example.test` })),
      projects: [1,2,3].map(i => ({ id: `p-${i}`, organization_id: 'org', created_at: '2026-09-01' })),
      developer_tasks: [1,2,3].map(i => ({ id: `t-${i}`, organization_id: 'org', status: 'completed' })),
      task_time_logs: [1,2,3].map(i => ({ id: `l-${i}`, organization_id: 'org', started_at: '2026-09-05T09:00:00Z' })),
      productivity_sessions: [1,2,3].map(i => ({ ...session(i, `u-${i}`), user_email: `developer${i}@example.test` })),
    };
    const db = database(tables, { cap: 2 });
    const result = await loadReportDataForClient(range, db.client, 'org');
    for (const key of ['projects','tasks','timeLogs','employees','sessions']) expect(result[key]).toHaveLength(3);
    expect(Object.values(result.truncated).every(v => v === false)).toBe(true);
    expect(result.employees[2].name).toBe('Developer 3');
    expect(teamProductivity(result)[2].trackedHours).toBe(1);
    expect(db.calls.filter(c => c.table === 'memberships').map(c => c.range)).toEqual([[0,999],[2,1001]]);
    expect(db.calls.filter(c => c.table === 'productivity_sessions').every(c => c.orders.some(([key]) => key === 'session_id'))).toBe(true);
  });
  it('preserves colliding typed profile names without reading rich HR data', async () => {
    const db = database({ memberships: [member(1),member(1,'admin')], developers: [{ id: 'u-1', organization_id: 'org', name: 'Dev' }], admin_users: [{ id: 'u-1', organization_id: 'org', full_name: 'Admin' }] });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(result.employees.find(e => e.userType === 'admin').name).toBe('Admin');
    expect(result.employees.find(e => e.userType === 'developer').name).toBe('Dev');
    expect(db.calls.some(c => c.table === 'employee_profiles')).toBe(false);
    expect(result.employees.every(e => !Object.hasOwn(e, 'profile'))).toBe(true);
  });
  it.each([5000,5001])('marks project ceiling accurately for %s rows', async total => {
    const db = database({ projects: Array.from({ length: total }, (_, i) => ({ id: `p-${String(i).padStart(5,'0')}`, organization_id: 'org', created_at: '2026-09-01' })) });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(result.projects).toHaveLength(5000); expect(result.truncated.projects).toBe(total > 5000);
    expect(db.calls.filter(c => c.table === 'projects').at(-1).range).toEqual([4000,4999]);
  });
  it('flags directory overflow instead of treating missing people as complete', async () => {
    const db = database({ memberships: Array.from({ length: 20001 }, (_,i) => member(i,'admin')) });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(result.employees).toHaveLength(20000); expect(result.truncated.employees).toBe(true);
  });
  it('deduplicates overlapping identity matches and enforces one global session budget', async () => {
    const db = database({ memberships: [member(1)], productivity_sessions: Array.from({ length: 10001 }, (_,i) => session(i)) });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(result.sessions).toHaveLength(10000); expect(result.truncated.sessions).toBe(true);
  });
  it('does not flag exact session cap twice merely because email also matches', async () => {
    const db = database({ memberships: [member(1)], productivity_sessions: Array.from({ length: 10000 }, (_,i) => session(i)) });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(result.sessions).toHaveLength(10000); expect(result.truncated.sessions).toBe(false);
  });
  it('rejects deletion between pages even when there are no duplicate row IDs', async () => {
    const db = database({ projects: [1,2,3].map(i => ({ id: `p-${i}`, organization_id: 'org' })) },
      { cap: 2, pagedCount: (call, count) => call.table === 'projects' && call.range[0] > 0 ? count - 1 : count });
    await expect(loadReportDataForClient(range, db.client, 'org')).rejects.toThrow('changed');
  });
  it('rejects missing exact page counts instead of claiming completeness', async () => {
    const db = database({}, { pagedCount: () => null });
    await expect(loadReportDataForClient(range, db.client, 'org')).rejects.toThrow('changed');
  });
  it('rejects duplicate page drift rather than adding repeated rows to totals', async () => {
    const db = database({ projects: [1,2,3].map(i => ({ id: `p-${i}`, organization_id: 'org' })) }, { cap: 2, repeat: call => call.table === 'projects' && call.range[0] > 0 });
    await expect(loadReportDataForClient(range, db.client, 'org')).rejects.toThrow('changed');
  });
  it('rejects a failed later directory page instead of dropping users', async () => {
    const db = database({ memberships: [member(1),member(2),member(3)] }, { cap: 2, fail: c => c.table === 'memberships' && c.range?.[0] === 2 });
    await expect(loadReportDataForClient(range, db.client, 'org')).rejects.toThrow('lookup');
  });
  it('does not supply exact headline counts for a truncated task set', async () => {
    const db = database({ developer_tasks: Array.from({ length: 20001 }, (_, i) => ({ id: `t-${i}`, organization_id: 'org', status: 'completed' })) });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(result.truncated.tasks).toBe(true);
    expect(result.statusCounts).toBeNull();
  });
  it('derives headline counts from the same task rows without independently racing HEAD queries', async () => {
    const db = database({
      projects: [{ id: 'p-1', organization_id: 'org' }],
      developer_tasks: [{ id: 't-1', organization_id: 'org', project_id: 'p-1', status: 'completed' },
        { id: 't-2', organization_id: 'org', project_id: 'p-1', status: 'reviewed' }],
    }, { count: 999 });
    const result = await loadReportDataForClient(range, db.client, 'org');
    expect(db.calls.some(call => call.head)).toBe(false);
    expect(result.statusCounts).toEqual({ pending: 0, in_progress: 0, awaiting_approval: 1, completed: 1, total: 2 });
    expect(summaryKpis(result).done).toBe(projectPerformance(result)[0].done);
    expect(summaryKpis(result).completionRate).toBe(50);
  });
});
