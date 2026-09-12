import { reportRangeBounds, validReportDate } from '@/utils/reportDates';

/** Monitoring dates are explicit UTC calendar dates, including the final day. */
export function monitoringDateWindow(selectedDate, timeRange) {
  const days = { today: 1, week: 7, month: 30 }[timeRange];
  if (!days || !validReportDate(selectedDate)) return null;
  try {
    const from = new Date(Date.parse(selectedDate) - (days - 1) * 86400000).toISOString().slice(0, 10);
    const bounds = reportRangeBounds({ from, to: selectedDate });
    return { start: bounds.fromIso, end: bounds.toIso };
  } catch { return null; }
}

/** A removed subscription may still deliver already queued callbacks. */
export function createMonitoringEventGuard({ organizationId, identity, scope,
  getOrganizationId, getIdentity, getScope, canMonitor }) {
  let disposed = false;
  const current = () => !disposed && !!organizationId && !!identity && canMonitor() === true
    && getOrganizationId() === organizationId && getIdentity() === identity && getScope() === scope;
  return {
    current,
    accepts: row => current() && !!row && row.organization_id === organizationId,
    dispose() { disposed = true; },
  };
}
