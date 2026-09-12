// Bind report data to the requesting typed identity and exact date range.
export function reportIdentity(context) {
  return context?.organizationId && context?.userId && context?.userType
    ? JSON.stringify([context.organizationId, context.userType, context.userId, context.role])
    : null;
}

export function currentReportState(result, scope, authenticated) {
  if (!authenticated) return { bundle: null, loading: false, error: 'Sign in to load reports.' };
  if (result?.scope !== scope) return { bundle: null, loading: true, error: '' };
  return { bundle: result.bundle, loading: false, error: result.error };
}

export function validateReportAggregate(data, organizationId, range, view, offset = 0, limit = 50) {
  if (!data || data.orgId !== organizationId || data.range?.from !== range.from || data.range?.to !== range.to || data.view !== view) {
    throw new Error('The report response did not match this organization, range and view. Please retry.');
  }
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const number = value => finite(value) && value >= 0;
  if (view === 'overview') {
    if (!data.kpis || !data.statusCounts || !data.totals || !data.trend
      || !['projects','tasks','done','completionRate','overdue'].every(key => number(data.kpis[key]))
      || !['loggedHours','trackedHours'].every(key => finite(data.kpis[key]))
      || !['pending','in_progress','awaiting_approval','completed','rejected'].every(key => number(data.statusCounts[key]))
      || !['projects','team','time','delays'].every(key => number(data.totals[key])) || !finite(data.totals.timedHours)
      || !Array.isArray(data.projectTop) || data.projectTop.length > 10 || !Array.isArray(data.teamTop) || data.teamTop.length > 12
      || !Array.isArray(data.trend.days) || !['completed','loggedHours','trackedHours'].every(key => Array.isArray(data.trend[key]) && data.trend[key].length === data.trend.days.length && data.trend[key].every(key === 'completed' ? number : finite))) {
      throw new Error('The report overview was incomplete. Please retry.');
    }
  } else {
    if (!Array.isArray(data.rows) || data.rows.length > limit || !Number.isSafeInteger(data.total) || data.total < 0
      || data.rows.length !== Math.min(limit, Math.max(0, data.total - offset))
      || data.nextOffset !== (offset + data.rows.length < data.total ? offset + data.rows.length : null)) {
      throw new Error('The report page was incomplete. Please retry.');
    }
    const keys = data.rows.map(row => view === 'projects' ? row.projectId : view === 'team' ? (row.userType && row.userId ? `${row.userType}:${row.userId}` : null) : row.id);
    if (keys.some(key => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) throw new Error('The report page contained invalid rows. Please retry.');
  }
  return data;
}
