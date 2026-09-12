import { authFetch } from '@/utils/authFetch';
import { getOrgContext } from '@/utils/orgContext';
import { reportRangeBounds, reportRangeDays } from '@/utils/reportDates';
import { reportIdentity, validateReportAggregate } from '@/utils/reportViewState';

const TABLE_VIEWS = ['projects', 'team', 'time', 'delays'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = value => Number.isSafeInteger(value) && value >= 0;
const failure = () => new Error('The report response was incomplete or changed while loading. Please retry.');

function rowKey(row, view) {
  if (view === 'team') return ['admin', 'developer'].includes(row?.userType) && typeof row?.userId === 'string' && UUID.test(row.userId)
    ? `${row.userType}:${row.userId.toLowerCase()}` : null;
  const value = view === 'projects' ? row?.projectId : row?.id;
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function requestScope(range) {
  reportRangeBounds(range);
  const context = getOrgContext();
  const identity = reportIdentity(context);
  if (!identity) throw new Error('Sign in to load reports.');
  return { range: { from: range.from, to: range.to }, organizationId: context.organizationId, identity };
}

function currentScope(scope) {
  return scope.identity === reportIdentity(getOrgContext());
}

async function requestReport(scope, view, offset, limit, current = () => true) {
  if (!current() || !currentScope(scope)) return null;
  const query = new URLSearchParams({ ...scope.range, view, offset: String(offset), limit: String(limit) });
  const response = await authFetch(`/api/reports?${query}`, { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!current() || !currentScope(scope)) return null;
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Reports are temporarily unavailable. Please retry.');
  validateReportAggregate(data, scope.organizationId, scope.range, view, offset, limit);
  if (view === 'overview') {
    if (!['projects','tasks','done','overdue'].every(key => count(data.kpis[key]))
      || !['pending','in_progress','awaiting_approval','completed','rejected','total'].every(key => count(data.statusCounts[key]))
      || !['projects','team','time','delays'].every(key => count(data.totals[key]))
      || data.statusCounts.total !== data.kpis.tasks || data.statusCounts.completed !== data.kpis.done
      || data.statusCounts.pending + data.statusCounts.in_progress + data.statusCounts.awaiting_approval + data.statusCounts.completed + data.statusCounts.rejected !== data.statusCounts.total
      || JSON.stringify(data.trend.days) !== JSON.stringify(reportRangeDays(scope.range))) throw failure();
    for (const [rows, kind] of [[data.projectTop, 'projects'], [data.teamTop, 'team']]) {
      const keys = rows.map(row => rowKey(row, kind));
      if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw failure();
    }
  } else {
    const keys = data.rows.map(row => rowKey(row, view));
    if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw failure();
  }
  return data;
}

export function loadReportOverview(range) {
  return requestReport(requestScope(range), 'overview', 0, 50);
}

export function loadReportPage(range, view, { offset = 0, limit = 50 } = {}) {
  if (!TABLE_VIEWS.includes(view) || !count(offset) || offset > 2147483647 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Invalid report view or page.');
  }
  return requestReport(requestScope(range), view, offset, limit);
}

// PDF needs the full row set. CSV uses the server streaming endpoint instead.
// A changing count or duplicate row aborts rather than exporting partial totals.
export async function loadReportExportRows(range, view, current = () => true) {
  if (!TABLE_VIEWS.includes(view)) throw new Error('Choose a report table to export.');
  if (!current()) return null;
  const scope = requestScope(range);
  const rows = [];
  const seen = new Set();
  let expectedTotal = null;
  let offset = 0;
  do {
    const page = await requestReport(scope, view, offset, 500, current);
    if (!page) return null;
    if (expectedTotal !== null && expectedTotal !== page.total) throw failure();
    expectedTotal = page.total;
    for (const row of page.rows) {
      const key = rowKey(row, view);
      if (seen.has(key)) throw failure();
      seen.add(key);
      rows.push(row);
    }
    if (page.nextOffset === null) {
      if (rows.length !== expectedTotal) throw failure();
      return current() && currentScope(scope) ? rows : null;
    }
    offset = page.nextOffset;
    // Let cancellation, navigation and painting run between large PDF pages.
    await new Promise(resolve => setTimeout(resolve, 0));
  } while (true);
}
