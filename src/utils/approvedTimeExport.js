import { validReportDate } from '@/utils/reportDates';
import { csvRow } from '@/utils/csvSerialization';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const typed = kind => ['admin', 'developer'].includes(kind);
const instant = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function validExportRange(from, to) {
  return validReportDate(from) && validReportDate(to) && new Date(from).getUTCDay() === 1 && new Date(to).getUTCDay() === 1 && from <= to && Date.parse(to) - Date.parse(from) <= 84 * 86400000;
}
export function validApprovedSnapshot(data, organizationId, from, to) {
  if (!data || data.organization_id !== organizationId || data.from_week !== from || data.to_week !== to || !validExportRange(from, to) || !instant(data.captured_at)
    || !Array.isArray(data.rows) || data.rows.length > 10000 || data.count !== data.rows.length) return false;
  const ids = new Set(), peopleWeeks = new Set(); let previous = '';
  for (const row of data.rows) {
    if (!row || !UUID.test(row.timesheet_id || '') || !UUID.test(row.user_id || '') || !typed(row.user_type) || typeof row.name !== 'string'
      || !validReportDate(row.week_start) || new Date(row.week_start).getUTCDay() !== 1 || row.week_start < from || row.week_start > to
      || !Number.isSafeInteger(row.approved_seconds) || row.approved_seconds <= 0 || !instant(row.approved_at) || !instant(row.source_updated_at)
      || !UUID.test(row.approved_by || '') || !typed(row.approved_by_type)) return false;
    const personWeek = `${row.week_start}:${row.user_type}:${row.user_id}`, order = `${personWeek}:${row.timesheet_id}`;
    if (ids.has(row.timesheet_id) || peopleWeeks.has(personWeek) || order <= previous) return false;
    ids.add(row.timesheet_id); peopleWeeks.add(personWeek); previous = order;
  }
  return true;
}
export function approvedTimeCsv(data, fingerprint) {
  const headings = ['Export fingerprint', 'Captured at UTC', 'Organization ID', 'Timesheet ID', 'Staff type', 'Staff ID', 'Staff name', 'Week start UTC', 'Approved seconds', 'Approved hours (rounded)', 'Approved at UTC', 'Approver type', 'Approver ID', 'Source updated at UTC'];
  return '\uFEFF' + [csvRow(headings), ...data.rows.map(row => csvRow([fingerprint, new Date(data.captured_at).toISOString(), data.organization_id, row.timesheet_id,
    row.user_type, row.user_id, row.name, row.week_start, row.approved_seconds, (row.approved_seconds / 3600).toFixed(6), new Date(row.approved_at).toISOString(), row.approved_by_type, row.approved_by, new Date(row.source_updated_at).toISOString()]))].join('\r\n');
}
