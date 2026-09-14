import { validReportDate } from '@/utils/reportDates';

export const SHIFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHIFT_STATUSES = ['draft', 'published', 'cancelled'];
export function shiftTimezone(value) {
  if (typeof value !== 'string' || value.length > 64 || !value) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}
export function shiftInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !validReportDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export function validateShiftInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.id !== 'string' || !SHIFT_UUID.test(body.id)
      || !Number.isSafeInteger(body.version) || body.version < 0 || body.version >= 2147483647
      || typeof body.userId !== 'string' || !SHIFT_UUID.test(body.userId) || !['admin', 'developer'].includes(body.userType)
      || !SHIFT_STATUSES.includes(body.status) || !shiftTimezone(body.timezone)
      || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120
      || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000))) throw new Error('Check the staff member, title, timezone and shift status.');
  const start = shiftInstant(body.start), end = shiftInstant(body.end);
  if (!start || !end || Date.parse(start) % 60000 !== 0 || Date.parse(end) % 60000 !== 0 || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 48 * 3600000) throw new Error('Choose a shift end after its start, no more than 48 hours later.');
  return { id: body.id.toLowerCase(), version: body.version, userId: body.userId.toLowerCase(), userType: body.userType,
    start, end, timezone: body.timezone, title: body.title.trim(), status: body.status, note: body.note ?? '' };
}

function wallClock(date, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Resolve current/future wall times explicitly, refusing DST gaps and ambiguity. */
export function localShiftCandidates(value, timezone) {
  if (!shiftTimezone(timezone) || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      || !validReportDate(value.slice(0, 10))) throw new Error('Enter a valid local date, time and timezone.');
  const naive = Date.parse(value + ':00Z');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const found = [];
  // All current IANA offsets are multiples of 15 minutes, including Nepal and
  // Chatham. Historical dates with second-level offsets are not guessed.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = new Date(naive + offset * 60000);
    if (wallClock(instant, formatter) === value) found.push(instant.toISOString());
  }
  return [...new Set(found)].sort();
}
export function resolveLocalShiftTime(value, timezone, occurrence = 'reject') {
  const choices = localShiftCandidates(value, timezone);
  if (!choices.length) throw new Error('That local time does not exist in this timezone. Choose a time outside the daylight-saving clock change.');
  if (choices.length > 1) {
    if (occurrence === 'earlier') return choices[0];
    if (occurrence === 'later') return choices.at(-1);
    throw new Error('That local time occurs twice. Choose the earlier or later occurrence.');
  }
  return choices[0];
}
export function localShiftValue(instant, timezone) {
  return wallClock(new Date(instant), new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
}
export function validShiftRow(row, organizationId) {
  return !!row && SHIFT_UUID.test(row.id || '') && row.organization_id === organizationId && SHIFT_UUID.test(row.user_id || '')
    && ['admin', 'developer'].includes(row.user_type) && SHIFT_STATUSES.includes(row.status) && shiftTimezone(row.timezone)
    && !!shiftInstant(row.start_at) && !!shiftInstant(row.end_at) && Date.parse(row.end_at) > Date.parse(row.start_at)
    && Number.isSafeInteger(row.version) && row.version > 0 && typeof row.title === 'string' && typeof row.note === 'string'
    && typeof row.assignee_name === 'string';
}
