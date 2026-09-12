import { validReportDate } from '@/utils/reportDates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id, developer_id, organization_id, login_date, login_time';
const failed = () => new Error('Login activity changed or could not be loaded completely. Please retry.');
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => typeof value === 'string' && validReportDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

/** Read complete login events with the caller's RLS-scoped client. */
export async function loadMonitoringLogins(client, { organizationId, profileId, start, end }, current = () => true) {
  if (!current()) return null;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || typeof profileId !== 'string' || !UUID.test(profileId) || !validTime(start) || !validTime(end) || Date.parse(start) >= Date.parse(end)) throw new Error('Invalid login activity identity or date range.');
  const org = organizationId.toLowerCase(), profile = profileId.toLowerCase();
  const base = (head = false) => client.from('developer_logins').select(head ? 'id' : FIELDS, { count: 'exact', ...(head ? { head: true } : {}) })
    .eq('organization_id', org).eq('developer_id', profile).gte('login_time', start).lt('login_time', end);
  try {
    const counted = await base(true);
    if (!current()) return null;
    if (counted.error || !validCount(counted.count)) throw failed();
    const total = counted.count, rows = [], seen = new Set();
    while (rows.length < total) {
      if (!current()) return null;
      const last = Math.min(rows.length + 499, total - 1);
      const result = await base().order('login_time', { ascending: true }).order('id', { ascending: true }).range(rows.length, last);
      if (!current()) return null;
      if (result.error || result.count !== total || !Array.isArray(result.data) || !result.data.length || result.data.length > last - rows.length + 1) throw failed();
      for (const row of result.data) {
        const id = row?.id;
        if (typeof id !== 'string' || !UUID.test(id) || seen.has(id.toLowerCase())
          || row.organization_id !== org || row.developer_id !== profile || !validTime(row.login_time)
          || Date.parse(row.login_time) < Date.parse(start) || Date.parse(row.login_time) >= Date.parse(end)) throw failed();
        seen.add(id.toLowerCase());
        rows.push(row);
      }
    }
    return current() ? rows : null;
  } catch {
    if (!current()) return null;
    throw failed();
  }
}
