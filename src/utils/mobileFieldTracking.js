import { shiftInstant } from '@/utils/workShifts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const mobileUuid = value => typeof value === 'string' && UUID.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const shape = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const instant = value => typeof value === 'string' && value.endsWith('Z') ? shiftInstant(value) : null;
export function validateMobilePayload(value) {
  if (!shape(value, ['id', 'segments', 'points', 'recovered']) || !mobileUuid(value.id) || typeof value.recovered !== 'boolean' || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 100 || !Array.isArray(value.points) || value.points.length > 2000) throw new Error('Invalid mobile session.');
  const ids = new Set(); let previous = 0, seconds = 0;
  const segments = value.segments.map(row => {
    if (!shape(row, ['id', 'start', 'end']) || !mobileUuid(row.id) || ids.has(row.id) || !instant(row.start) || !instant(row.end)) throw new Error('Invalid work segment.');
    const start = Date.parse(row.start), end = Date.parse(row.end);
    if (start < previous || end - start < 1000) throw new Error('Work segments must be ordered and non-overlapping.');
    previous = end; ids.add(row.id); seconds += Math.floor((end - start) / 1000);
    return { id: row.id.toLowerCase(), start: instant(row.start), end: instant(row.end) };
  });
  if (Date.parse(segments.at(-1).end) - Date.parse(segments[0].start) > 86400000) throw new Error('A mobile session can span at most 24 hours.');
  previous = 0;
  const points = value.points.map(row => {
    if (!shape(row, ['at', 'lat', 'lon', 'accuracy', 'mock']) || !instant(row.at) || !finite(row.lat) || Math.abs(row.lat) > 90 || !finite(row.lon) || Math.abs(row.lon) > 180 || !finite(row.accuracy) || row.accuracy < 0 || row.accuracy > 10000 || typeof row.mock !== 'boolean') throw new Error('Invalid location sample.');
    const at = Date.parse(row.at);
    if (at <= previous || !segments.some(segment => at >= Date.parse(segment.start) && at <= Date.parse(segment.end))) throw new Error('Location samples must belong to recorded work segments.');
    previous = at; return { ...row, at: instant(row.at) };
  });
  return { payload: { id: value.id.toLowerCase(), segments, points, recovered: value.recovered }, seconds };
}
export function validWorkSite(site, org) {
  return site && mobileUuid(site.id) && site.organization_id === org && typeof site.name === 'string' && site.name.trim().length > 0 && site.name.length <= 100
    && finite(site.latitude) && Math.abs(site.latitude) <= 90 && finite(site.longitude) && Math.abs(site.longitude) <= 180 && Number.isInteger(site.radius_m) && site.radius_m >= 100 && site.radius_m <= 10000
    && typeof site.active === 'boolean' && Number.isSafeInteger(site.version) && site.version > 0;
}
export function classifyGeofence(point, sites) {
  if (point.mock) return { state: 'uncertain', site: null, reason: 'Device marked this sample as mock.' };
  const radians = value => value * Math.PI / 180;
  const candidates = sites.filter(site => site.active).map(site => {
    const a = Math.sin(radians(site.latitude - point.lat) / 2) ** 2 + Math.cos(radians(point.lat)) * Math.cos(radians(site.latitude)) * Math.sin(radians(site.longitude - point.lon) / 2) ** 2;
    const distance = 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    return { site: site.name, distance, radius: site.radius_m };
  }).sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return { state: 'unconfigured', site: null };
  const inside = candidates.find(site => site.distance + point.accuracy <= site.radius);
  if (inside) return { state: 'inside', site: inside.site };
  const uncertain = candidates.find(site => site.distance - point.accuracy <= site.radius);
  return uncertain ? { state: 'uncertain', site: uncertain.site } : { state: 'outside', site: candidates[0].site };
}
export async function readMobileJson(request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Request body is required.');
  const decoder = new TextDecoder(); let text = '', size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1000000) { await reader.cancel(); throw new Error('Request is too large.'); } text += decoder.decode(value, { stream: true }); }
  return JSON.parse(text + decoder.decode());
}
