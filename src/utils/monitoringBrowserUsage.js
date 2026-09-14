import { validReportDate } from '@/utils/reportDates';
import { csvRow } from '@/utils/csvSerialization';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id,organization_id,user_email,session_id,site,first_seen,last_seen,duration_seconds,duration_minutes';
const failed = () => new Error('Website activity changed or could not be loaded completely. Please retry.');
const validTime = value => typeof value === 'string' && validReportDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const validCount = value => Number.isSafeInteger(value) && value >= 0;
function seconds(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) throw failed();
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw failed();
  return number;
}

/** Captured first-seen dates, complete pages, current caller's RLS client only. */
export async function loadMonitoringBrowserUsage(client, { organizationId, email, start, end }, current = () => true, signal) {
  if (!current()) return null;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || typeof email !== 'string' || !email.trim() || email !== email.trim()
      || !validTime(start) || !validTime(end) || Date.parse(start) >= Date.parse(end)) throw failed();
  const organization = organizationId.toLowerCase();
  const base = (head = false) => {
    let query = client.from('browser_usage').select(head ? 'id' : FIELDS, { count: 'exact', ...(head ? { head: true } : {}) })
      .eq('organization_id', organization).eq('user_email', email).gte('first_seen', start).lt('first_seen', end);
    if (signal) query = query.abortSignal(signal);
    return query;
  };
  try {
    const counted = await base(true);
    if (!current()) return null;
    if (counted.error || !validCount(counted.count)) throw failed();
    const total = counted.count, rows = [], seen = new Set();
    while (rows.length < total) {
      const result = await base().order('first_seen', { ascending: false }).order('id', { ascending: false })
        .range(rows.length, Math.min(rows.length + 499, total - 1));
      if (!current()) return null;
      if (result.error || result.count !== total || !Array.isArray(result.data) || !result.data.length
          || result.data.length > Math.min(500, total - rows.length)) throw failed();
      for (const row of result.data) {
        if (!row || !['string', 'number'].includes(typeof row.id) || !String(row.id).trim()
            || (typeof row.id === 'number' && !Number.isSafeInteger(row.id)) || seen.has(String(row.id))
            || row.organization_id !== organization || row.user_email !== email
            || typeof row.site !== 'string' || !row.site.trim() || row.site.length > 2048
            || !validTime(row.first_seen) || Date.parse(row.first_seen) < Date.parse(start)
            || Date.parse(row.first_seen) >= Date.parse(end) || !validTime(row.last_seen)) throw failed();
        // Seconds are authoritative. Legacy minute-only rows remain readable.
        const duration = row.duration_seconds == null ? seconds(row.duration_minutes) * 60 : seconds(row.duration_seconds);
        if (!Number.isFinite(duration)) throw failed();
        seen.add(String(row.id));
        rows.push({ ...row, duration_seconds: duration });
      }
    }
    const confirmed = await base(true);
    if (!current()) return null;
    if (confirmed.error || confirmed.count !== total) throw failed();
    return rows;
  } catch {
    if (!current()) return null;
    throw failed();
  }
}

export function summarizeBrowserUsage(rows) {
  const sites = new Map();
  let totalSeconds = 0;
  for (const row of rows) {
    const duration = seconds(row.duration_seconds);
    const current = sites.get(row.site) || { site: row.site, seconds: 0, records: 0 };
    current.seconds += duration; current.records++;
    totalSeconds += duration;
    if (!Number.isFinite(current.seconds) || !Number.isFinite(totalSeconds)) throw failed();
    sites.set(row.site, current);
  }
  return { totalSeconds, records: rows.length, sites: [...sites.values()].sort((a, b) => b.seconds - a.seconds || a.site.localeCompare(b.site)) };
}

export function browserUsageCsv(rows) {
  return '\uFEFF' + [csvRow(['Website label or domain', 'First seen (UTC)', 'Last seen (UTC)', 'Observed seconds', 'Session ID']),
    ...rows.map(row => csvRow([row.site, new Date(row.first_seen).toISOString(), new Date(row.last_seen).toISOString(), row.duration_seconds, row.session_id]))].join('\r\n');
}
