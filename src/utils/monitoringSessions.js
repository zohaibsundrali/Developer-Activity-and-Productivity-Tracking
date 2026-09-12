import { validReportDate } from '@/utils/reportDates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'session_id, organization_id, user_id, user_email, start_time, end_time, total_duration, active_duration, idle_duration, productivity_score, status, mouse_events, keyboard_events, screenshots_taken, created_at, app_usage_summary, project_id, task_id';
const failed = () => new Error('Session activity changed or could not be loaded completely. Please retry.');
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => typeof value === 'string' && validReportDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

function duration(value) {
  if (value === null || value === undefined) return null;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^\s*\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value))) throw failed();
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw failed();
  return number;
}

/** Captured-start cohorts; duration counters are seconds, never wall-clock estimates. */
export async function loadMonitoringSessions(client, { organizationId, profileId, email, start, end }, current = () => true) {
  if (!current()) return null;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || typeof profileId !== 'string' || !UUID.test(profileId)
    || (email != null && (typeof email !== 'string' || !email.trim() || email !== email.trim()))
    || !validTime(start) || !validTime(end) || Date.parse(start) >= Date.parse(end)) throw new Error('Invalid session activity identity or date range.');
  const org = organizationId.toLowerCase(), profile = profileId.toLowerCase();
  const rows = [], seen = new Set();
  try {
    for (const legacy of email ? [false, true] : [false]) {
      const base = (head = false) => {
        let query = client.from('productivity_sessions').select(head ? 'session_id' : FIELDS, { count: 'exact', ...(head ? { head: true } : {}) })
          .eq('organization_id', org).gte('start_time', start).lt('start_time', end);
        query = legacy ? query.is('user_id', null).eq('user_email', email) : query.eq('user_id', profile);
        return query;
      };
      if (!current()) return null;
      const counted = await base(true);
      if (!current()) return null;
      if (counted.error || !validCount(counted.count)) throw failed();
      const total = counted.count;
      let loaded = 0;
      while (loaded < total) {
        if (!current()) return null;
        const last = Math.min(loaded + 499, total - 1);
        const result = await base().order('start_time', { ascending: false }).order('session_id', { ascending: false }).range(loaded, last);
        if (!current()) return null;
        if (result.error || result.count !== total || !Array.isArray(result.data) || !result.data.length || result.data.length > last - loaded + 1) throw failed();
        for (const row of result.data) {
          const id = row?.session_id;
          if (typeof id !== 'string' || !id.trim() || seen.has(id) || row.organization_id !== org
            || (legacy ? row.user_id !== null || row.user_email !== email : row.user_id !== profile)
            || !validTime(row.start_time) || Date.parse(row.start_time) < Date.parse(start) || Date.parse(row.start_time) >= Date.parse(end)) throw failed();
          seen.add(id);
          const normalized = { ...row };
          for (const field of ['total_duration', 'active_duration', 'idle_duration', 'productivity_score']) normalized[field] = duration(row[field]);
          if (normalized.productivity_score !== null && normalized.productivity_score > 100) throw failed();
          rows.push(normalized);
        }
        loaded += result.data.length;
      }
    }
    rows.sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time) || (a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0));
    return current() ? rows : null;
  } catch {
    if (!current()) return null;
    throw failed();
  }
}

export function sumMonitoringSessionDuration(rows, field = 'total_duration') {
  if (!['total_duration', 'active_duration', 'idle_duration'].includes(field)) return null;
  let total = 0;
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}
