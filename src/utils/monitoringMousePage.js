import { validReportDate } from '@/utils/reportDates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id, organization_id, session_id, developer_id, developer_name, timestamp, activity_status, active_percentage, idle_percentage, created_at';
const failed = () => new Error('Mouse activity changed or could not be loaded completely. Please retry.');
const validCount = value => Number.isSafeInteger(value) && value >= 0;

/** Fill one visible mouse-activity page through the caller's scoped client. */
export async function loadMonitoringMousePage(client, { organizationId, developerIds, start, end, page = 1, pageSize = 50 }, current = () => true) {
  if (!current()) return null;
  const validTime = value => typeof value === 'string' && validReportDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
  const offset = (page - 1) * pageSize;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || !Array.isArray(developerIds) || !developerIds.length
    || developerIds.some(id => typeof id !== 'string' || !UUID.test(id))
    || !Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isSafeInteger(offset)
    || !validTime(start) || !validTime(end) || Date.parse(start) >= Date.parse(end)) throw new Error('Invalid mouse activity identity, range or page.');
  const ids = [...new Set(developerIds.map(id => id.toLowerCase()))];
  const org = organizationId.toLowerCase();
  const base = (head = false) => client.from('mouse_activities').select(head ? 'id' : FIELDS, { count: 'exact', ...(head ? { head: true } : {}) })
    .eq('organization_id', org).in('developer_id', ids).gte('timestamp', start).lt('timestamp', end);
  try {
    // Count first prevents PostgREST 416 for a page removed by a deletion.
    const counted = await base(true);
    if (!current()) return null;
    if (counted.error || !validCount(counted.count)) throw failed();
    const total = counted.count;
    const wanted = Math.min(pageSize, Math.max(0, total - offset));
    const rows = [], seen = new Set();
    while (rows.length < wanted) {
      if (!current()) return null;
      const result = await base().order('timestamp', { ascending: false }).order('id', { ascending: false })
        .range(offset + rows.length, offset + wanted - 1);
      if (!current()) return null;
      if (result.error || result.count !== total || !Array.isArray(result.data) || !result.data.length || result.data.length > wanted - rows.length) throw failed();
      for (const row of result.data) {
        const id = row?.id;
        if (((typeof id !== 'string' || !id.trim()) && (typeof id !== 'number' || !Number.isSafeInteger(id))) || seen.has(String(id))
          || row.organization_id !== org || !ids.includes(row.developer_id)
          || !Number.isFinite(Date.parse(row.timestamp)) || Date.parse(row.timestamp) < Date.parse(start) || Date.parse(row.timestamp) >= Date.parse(end)) throw failed();
        seen.add(String(id)); rows.push(row);
      }
    }
    return current() ? { rows, total } : null;
  } catch (error) {
    if (!current()) return null;
    throw error;
  }
}
