import { validReportDate } from '@/utils/reportDates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id, organization_id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login';
const failed = () => new Error('App activity changed or could not be loaded completely. Please retry.');
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => typeof value === 'string' && validReportDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

function duration(value) {
  if (value === null || value === undefined) return null;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^\s*\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value))) throw failed();
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw failed();
  return number;
}

/** Read complete captured-time aggregates with the caller's RLS-scoped client. */
export async function loadMonitoringAppUsage(client, { organizationId, email, start, end }, current = () => true) {
  if (!current()) return null;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || typeof email !== 'string' || !email.trim()
    || email !== email.trim() || !validTime(start) || !validTime(end) || Date.parse(start) >= Date.parse(end)) throw new Error('Invalid app activity identity or date range.');
  const org = organizationId.toLowerCase();
  const base = (head = false) => client.from('app_usage').select(head ? 'id' : FIELDS, { count: 'exact', ...(head ? { head: true } : {}) })
    .eq('organization_id', org).eq('user_email', email).gte('start_time', start).lt('start_time', end);
  try {
    const counted = await base(true);
    if (!current()) return null;
    if (counted.error || !validCount(counted.count)) throw failed();
    const total = counted.count, rows = [], seen = new Set();
    while (rows.length < total) {
      if (!current()) return null;
      const last = Math.min(rows.length + 499, total - 1);
      const result = await base().order('start_time', { ascending: false }).order('id', { ascending: false }).range(rows.length, last);
      if (!current()) return null;
      if (result.error || result.count !== total || !Array.isArray(result.data) || !result.data.length || result.data.length > last - rows.length + 1) throw failed();
      for (const row of result.data) {
        const id = row?.id;
        if (((typeof id !== 'string' || !id.trim()) && (typeof id !== 'number' || !Number.isSafeInteger(id))) || seen.has(String(id))
          || row.organization_id !== org || row.user_email !== email || !validTime(row.start_time)
          || Date.parse(row.start_time) < Date.parse(start) || Date.parse(row.start_time) >= Date.parse(end)) throw failed();
        const seconds = duration(row.duration_seconds), minutes = duration(row.duration_minutes);
        if (seconds === null && minutes === null) throw failed();
        const normalizedSeconds = seconds ?? minutes * 60;
        const normalizedMinutes = minutes ?? seconds / 60;
        if (!Number.isFinite(normalizedSeconds) || !Number.isFinite(normalizedMinutes)) throw failed();
        seen.add(String(id));
        rows.push({ ...row, duration_seconds: normalizedSeconds, duration_minutes: normalizedMinutes });
      }
    }
    return current() ? rows : null;
  } catch {
    if (!current()) return null;
    throw failed();
  }
}
