import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readClientRows } from '@/app/api/client/_lib/pagination';
const state = vi.hoisted(() => ({ auth: null, rows: {}, calls: [], failTable: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedClient: async () => state.auth,
  clientCanAccessProject: (auth, id) => auth.projectIds.includes(id),
  serviceClient: () => ({ from(table) {
    const filters = [], orders = []; let countRequested = false, head = false, single = false, start = 0, end = 999;
    const query = {
      select(columns, options) { countRequested = options?.count === 'exact'; head = options?.head; return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { expect(values.length).toBeLessThanOrEqual(100); filters.push(row => values.includes(row[key])); return query; },
      order(key, options) { orders.push([key, options?.ascending !== false]); return query; },
      single() { single = true; return query; },
      range(from, to) { start = from; end = to; return query; },
      then(resolve, reject) {
        state.calls.push({ table, start, end, countRequested });
        if (state.failTable === table) return Promise.resolve({ data: null, error: new Error('database read failed') }).then(resolve, reject);
        const rows = (state.rows[table] || []).filter(row => filters.every(filter => filter(row))).sort((a,b) => {
          for (const [key, ascending] of orders) { const n = String(a[key] || '').localeCompare(String(b[key] || '')); if(n) return ascending ? n : -n; } return 0;
        });
        return Promise.resolve({ data: head ? null : single ? rows[0] : rows.slice(start, Math.min(end + 1, start + 500)), count: countRequested ? rows.length : null, error: null }).then(resolve, reject);
      },
    }; return query;
  } }),
}));
import { GET as listProjects } from '@/app/api/client/projects/route';
import { GET as projectDetail } from '@/app/api/client/projects/[id]/route';
beforeEach(() => {
  state.auth = { orgId: 'org', projectIds: ['project'] }; state.calls = []; state.failTable = null;
  state.rows = {
    projects: [{ id: 'project', organization_id: 'org', name: 'QA', created_at: '2026-01-01' }],
    developer_tasks: Array.from({ length: 1101 }, (_, i) => ({ id: `task-${String(i).padStart(4,'0')}`, organization_id: 'org', project_id: 'project', client_visible: true, status: i < 1000 ? 'completed' : 'rejected' })),
    approvals: Array.from({ length: 1005 }, (_, i) => ({ id: `approval-${i}`, organization_id: 'org', project_id: 'project', status: 'pending' })),
    task_attachments: Array.from({ length: 1101 }, (_, i) => ({ id: `attachment-${i}`, organization_id: 'org', task_id: `task-${String(i).padStart(4,'0')}` })),
  };
  state.rows.developer_tasks.push({ id: 'private-task', organization_id: 'org', project_id: 'project', client_visible: false, status: 'pending' });
  state.rows.developer_tasks.push({ id: 'foreign-task', organization_id: 'other-org', project_id: 'project', client_visible: true, status: 'pending' });
});
describe('client project API pagination', () => {
  it('counts more than 1000 visible tasks and approvals in list summaries', async () => {
    const response = await listProjects(new Request('http://localhost/api/client/projects'));
    expect(response.status).toBe(200);
    const { projects } = await response.json();
    expect(projects[0]).toMatchObject({ open_tasks: 101, progress: 91, pending_approvals: 1005 });
    expect(state.calls.filter(x => x.table === 'developer_tasks').map(x => x.start)).toEqual([0,500,1000]);
  });
  it('returns full detail with attachment counts while keeping internal and other-org tasks out', async () => {
    const response = await projectDetail(new Request('http://localhost/api/client/projects/project'), { params: Promise.resolve({ id: 'project' }) });
    expect(response.status).toBe(200);
    const { project } = await response.json();
    expect(project.tasks).toHaveLength(1101);
    expect(project.tasks.every(task => task.attachment_count === 1)).toBe(true);
    expect(project).toMatchObject({ open_tasks: 101, progress: 91, pending_approvals: 1005 });
  });
  it('loads more than 1000 linked projects through bounded ID filters and restores global order', async () => {
    state.rows.projects = Array.from({ length: 1101 }, (_, i) => ({ id: `project-${String(i).padStart(4,'0')}`, organization_id: 'org', name: `Project ${i}`, created_at: new Date(Date.UTC(2026,0,1) + i * 1000).toISOString() }));
    state.auth.projectIds = state.rows.projects.map(row => row.id);
    state.rows.developer_tasks = []; state.rows.approvals = [];
    const response = await listProjects(new Request('http://localhost/api/client/projects'));
    expect(response.status).toBe(200);
    const { projects } = await response.json();
    expect(projects).toHaveLength(1101); expect(projects[0].id).toBe('project-1100'); expect(projects.at(-1).id).toBe('project-0000');
  });
  it('fails rather than publishing partial totals after a database error', async () => {
    state.failTable = 'developer_tasks';
    expect((await listProjects(new Request('http://localhost/api/client/projects'))).status).toBe(500);
  });
});
describe('complete client reads', () => {
  const rows = Array.from({ length: 1101 }, (_, id) => ({ id: `row-${id}` }));
  it('continues from actual page size when the service cap is lower than the requested range', async () => {
    const result = await readClientRows(() => ({ range: async (start) => ({ data: rows.slice(start,start + 37), count: rows.length }) }));
    expect(result.error).toBeNull(); expect(result.data).toHaveLength(1101);
  });
  it.each(['missing-count', 'changed-count', 'duplicate-page', 'empty-page'])('rejects %s instead of claiming complete totals', async kind => {
    let call = 0;
    const result = await readClientRows(() => ({ range: async start => {
      ++call;
      return { data: kind === 'empty-page' && call > 1 ? [] : rows.slice(kind === 'duplicate-page' ? 0 : start, (kind === 'duplicate-page' ? 0 : start) + 500), count: kind === 'missing-count' ? null : rows.length + (kind === 'changed-count' && call > 1 ? 1 : 0) };
    } }));
    expect(result.data).toBeNull(); expect(result.error).toBeTruthy();
  });
});
