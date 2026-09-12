import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ context: null, fetch: vi.fn() }));
vi.mock('@/utils/authFetch', () => ({ authFetch: (...args) => state.fetch(...args) }));
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => state.context }));
import { loadReportOverview, loadReportPage, loadReportExportRows } from '@/utils/reportApiData';
const range = { from: '2026-09-12', to: '2026-09-12' };
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = n => ({ id: id(n), hours: 1 });
const page = (rows, total = rows.length, nextOffset = null, patch = {}) => ({ orgId: 'org', range, view: 'time', rows, total, nextOffset, ...patch });
const overview = () => ({ orgId: 'org', range, view: 'overview',
  kpis: { projects: 0, tasks: 1, done: 1, completionRate: 100, loggedHours: 0, trackedHours: 0, overdue: 0 },
  statusCounts: { pending: 0, in_progress: 0, awaiting_approval: 0, completed: 1, rejected: 0, total: 1 },
  totals: { projects: 0, team: 0, time: 0, delays: 0, timedHours: 0 }, projectTop: [], teamTop: [],
  trend: { days: [range.from], completed: [1], loggedHours: [0], trackedHours: [0] } });
const response = (body, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { state.context = { organizationId: 'org', userId: 'user', userType: 'developer', role: 'manager' }; state.fetch.mockReset(); });
describe('aggregate report API data', () => {
  it('loads a validated overview using exact range and no-cache requests', async () => {
    state.fetch.mockResolvedValue(response(overview()));
    expect((await loadReportOverview(range)).kpis.done).toBe(1);
    const [url, options] = state.fetch.mock.calls[0];
    expect(url).toContain('view=overview'); expect(url).toContain('from=2026-09-12'); expect(options.cache).toBe('no-store');
  });
  it('preserves rejected tasks as their own status bucket in overview totals', async () => {
    const data = overview(); data.statusCounts.rejected = 2; data.statusCounts.total = 3;
    data.kpis.tasks = 3; data.kpis.completionRate = 33.3;
    state.fetch.mockResolvedValue(response(data));
    expect((await loadReportOverview(range)).statusCounts.rejected).toBe(2);
  });
  it('validates page offset, view and typed identity before returning rows', async () => {
    state.fetch.mockResolvedValue(response(page([row(1)], 2, null)));
    expect((await loadReportPage(range, 'time', { offset: 1, limit: 1 })).rows).toHaveLength(1);
    expect(state.fetch.mock.calls[0][0]).toContain('offset=1&limit=1');
  });
  it.each([{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { offset: -1 }, { offset: 2147483648 }, { offset: '1' }])('rejects invalid paging %j without fetching', options => {
    expect(() => loadReportPage(range, 'time', options)).toThrow(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid range, view or absent identity before fetching', () => {
    expect(() => loadReportOverview({ from: 'bad', to: range.to })).toThrow();
    expect(() => loadReportPage(range, 'unknown')).toThrow();
    state.context = null; expect(() => loadReportOverview(range)).toThrow('Sign in'); expect(state.fetch).not.toHaveBeenCalled();
  });
  it.each([{ orgId: 'foreign' }, { range: { ...range, to: '2026-09-13' } }, { view: 'team' }, { total: 1.2 }, { total: 2, nextOffset: null }, { nextOffset: 0 }, { rows: [{ id: 'bad' }] }])('rejects a mismatched or incomplete page %j', async patch => {
    state.fetch.mockResolvedValue(response(page([row(1)], 1, null, patch)));
    await expect(loadReportPage(range, 'time', { limit: 1 })).rejects.toThrow();
  });
  it('rejects invalid overview totals, mismatched dates and inconsistent statuses', async () => {
    for (const change of [data => { data.statusCounts.completed = 0; }, data => { data.trend.days = ['2026-09-11']; }, data => { data.totals.projects = 0.2; }]) {
      const data = overview(); change(data); state.fetch.mockResolvedValue(response(data));
      await expect(loadReportOverview(range)).rejects.toThrow();
    }
  });
  it('discards an account or role switch that happens during the request', async () => {
    state.fetch.mockImplementation(async () => { state.context = { ...state.context, role: 'employee' }; return response(overview()); });
    expect(await loadReportOverview(range)).toBeNull();
  });
  it('surfaces HTTP failure and malformed response instead of empty charts', async () => {
    state.fetch.mockResolvedValue(response({ error: 'Plan unavailable' }, false)); await expect(loadReportOverview(range)).rejects.toThrow('Plan unavailable');
    state.fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error(); } }); await expect(loadReportOverview(range)).rejects.toThrow();
  });
});
describe('complete paged PDF row loading', () => {
  it('loads beyond one page and returns all rows once', async () => {
    state.fetch.mockResolvedValueOnce(response(page(Array.from({ length: 500 }, (_,i) => row(i)), 501, 500)))
      .mockResolvedValueOnce(response(page([row(500)], 501)));
    expect(await loadReportExportRows(range, 'time')).toHaveLength(501);
    expect(state.fetch.mock.calls[1][0]).toContain('offset=500&limit=500');
  });
  it('rejects changed total across pages', async () => {
    state.fetch.mockResolvedValueOnce(response(page(Array.from({ length: 500 }, (_,i) => row(i)), 501, 500)))
      .mockResolvedValueOnce(response(page([row(500), row(501)], 502)));
    await expect(loadReportExportRows(range, 'time')).rejects.toThrow('changed');
  });
  it('rejects duplicate rows across pages even when total is unchanged', async () => {
    state.fetch.mockResolvedValueOnce(response(page(Array.from({ length: 500 }, (_,i) => row(i)), 501, 500)))
      .mockResolvedValueOnce(response(page([row(0)], 501)));
    await expect(loadReportExportRows(range, 'time')).rejects.toThrow('changed');
  });
  it('does not return partial rows when a later page fails', async () => {
    state.fetch.mockResolvedValueOnce(response(page(Array.from({ length: 500 }, (_,i) => row(i)), 501, 500)))
      .mockRejectedValueOnce(new Error('offline'));
    await expect(loadReportExportRows(range, 'time')).rejects.toThrow('offline');
  });
  it('yields between pages and cancels without fetching more rows', async () => {
    let current = true;
    state.fetch.mockImplementation(async () => {
      setTimeout(() => { current = false; }, 0);
      return response(page(Array.from({ length: 500 }, (_,i) => row(i)), 501, 500));
    });
    expect(await loadReportExportRows(range, 'time', () => current)).toBeNull(); expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it('returns null without any request when cancelled initially', async () => {
    expect(await loadReportExportRows(range, 'time', () => false)).toBeNull(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it('returns a confirmed empty complete row set', async () => {
    state.fetch.mockResolvedValue(response(page([]))); expect(await loadReportExportRows(range, 'time')).toEqual([]);
  });
  it('keeps colliding admin/developer row identities distinct in team exports', async () => {
    state.fetch.mockResolvedValue(response(page([{ userId: id(1), userType: 'admin' }, { userId: id(1), userType: 'developer' }], 2, null, { view: 'team' })));
    expect(await loadReportExportRows(range, 'team')).toHaveLength(2);
  });
});
