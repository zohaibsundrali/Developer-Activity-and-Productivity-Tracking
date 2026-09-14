import { shiftInstant, shiftTimezone, SHIFT_UUID } from '@/utils/workShifts';
import { validReportDate } from '@/utils/reportDates';
export const exceptionGrace = value => Number.isSafeInteger(value) && value >= 0 && value <= 120;
const day = (instant, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const stamp = value => value === null ? null : shiftInstant(value) ? Date.parse(value) : NaN;
export function classifyShiftAttendance(snapshot, lateGrace, earlyGrace) {
  const { shift: s, attendance, leave, neighbours } = snapshot || {};
  if (!s || !SHIFT_UUID.test(s.id) || !shiftTimezone(s.timezone) || !shiftInstant(s.start_at) || !shiftInstant(s.end_at)
      || s.status !== 'published' || !exceptionGrace(lateGrace) || !exceptionGrace(earlyGrace)
      || !Array.isArray(attendance) || !Array.isArray(leave) || !Array.isArray(neighbours)) throw new Error('Invalid shift evidence.');
  const start = Date.parse(s.start_at), end = Date.parse(s.end_at);
  if (end <= start || end - start > 48 * 3600000) throw new Error('Invalid shift interval.');
  const first = day(start, s.timezone), last = day(end - 1, s.timezone), dates = [];
  for (let date = first; date <= last; date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)) dates.push(date);
  for (const a of attendance) if (!SHIFT_UUID.test(a.id) || !validReportDate(a.work_date) || !['present','remote','absent','holiday','on_leave'].includes(a.status)
      || Number.isNaN(stamp(a.check_in_at)) || Number.isNaN(stamp(a.check_out_at)) || (a.check_out_at && (!a.check_in_at || stamp(a.check_out_at) < stamp(a.check_in_at)))) throw new Error('Invalid attendance evidence.');
  for (const l of leave) if (!SHIFT_UUID.test(l.id) || !validReportDate(l.start_date) || !validReportDate(l.end_date) || l.start_date > l.end_date || !Number.isFinite(l.days) || l.days <= 0) throw new Error('Invalid leave evidence.');
  for (const n of neighbours) if (!SHIFT_UUID.test(n.id) || !shiftInstant(n.start_at) || !shiftInstant(n.end_at) || Date.parse(n.end_at) <= Date.parse(n.start_at)) throw new Error('Invalid adjacent shift.');
  const manual = reason => ({ outcome: 'manual_review', flags: ['manual_review'], reason, late_seconds: 0, early_seconds: 0 });
  const fullLeave = l => l.days === (Date.parse(l.end_date) - Date.parse(l.start_date)) / 86400000 + 1;
  const covered = dates.every(date => leave.some(l => fullLeave(l) && l.start_date <= date && l.end_date >= date));
  const holiday = dates.every(date => attendance.some(a => a.work_date === date && a.status === 'holiday'));
  const overlaps = (a, lo, hi) => stamp(a.check_in_at) < hi && (a.check_out_at ? stamp(a.check_out_at) > lo : stamp(a.check_in_at) >= lo - 12 * 3600000);
  const clocks = attendance.filter(a => a.check_in_at && overlaps(a, start, end));
  if (covered || holiday) return clocks.length ? manual('Recorded work overlaps approved leave or a holiday; reconcile the evidence.') : { outcome: covered ? 'approved_leave' : 'holiday', flags: [], reason: 'All local calendar dates touched by this shift are covered.', late_seconds: 0, early_seconds: 0 };
  if (leave.length) return manual('Partial-day or partial-shift leave needs a manager to match its actual hours.');
  if (clocks.length > 1) return manual('Multiple daily clock records overlap this shift.');
  if (!clocks.length) {
    if (attendance.some(a => dates.includes(a.work_date) && (a.check_in_at || ['on_leave','holiday'].includes(a.status)))) return manual('Daily attendance does not establish a matching shift interval.');
    return { outcome: 'exception', flags: ['missed_shift'], reason: 'No matching attendance clock or full leave coverage was recorded.', late_seconds: 0, early_seconds: 0 };
  }
  const a = clocks[0];
  if (!['present','remote'].includes(a.status)) return manual('Attendance status conflicts with its recorded clocks.');
  if (neighbours.some(n => overlaps(a, Date.parse(n.start_at), Date.parse(n.end_at)))) return manual('One daily clock overlaps more than one published shift; do not count it twice.');
  const late = Math.max(0, (stamp(a.check_in_at) - start) / 1000);
  const early = a.check_out_at ? Math.max(0, (end - stamp(a.check_out_at)) / 1000) : 0;
  const flags = [...(late > lateGrace * 60 ? ['late_arrival'] : []), ...(!a.check_out_at ? ['missing_checkout'] : early > earlyGrace * 60 ? ['early_departure'] : [])];
  return { outcome: flags.length ? 'exception' : 'on_time', flags, reason: a.check_out_at ? 'Matched recorded attendance clocks.' : 'Check-in exists but checkout is missing.', late_seconds: late, early_seconds: early, attendance_id: a.id };
}
