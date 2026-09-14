import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { authCan } from '@/utils/serverPermissions';
import { validReportDate } from '@/utils/reportDates';
import { SHIFT_UUID, shiftInstant, validateShiftInput, validShiftRow } from '@/utils/workShifts';

export const dynamic = 'force-dynamic';
const COLUMNS = 'id,organization_id,user_id,user_type,assignee_name,title,start_at,end_at,timezone,status,note,version,updated_at';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } });
const fail = (error, status = 400) => reply({ success: false, error }, status);
function databaseFailure(error) {
  const token = String(error?.message || '').split(':')[0];
  if (token === 'BILLING_LOCKED') return fail('Your subscription requires attention before the schedule can change.', 402);
  if (error?.code === '42501') return fail('You do not have permission for this schedule action.', 403);
  if (error?.code === 'P0002') return fail('The shift or active staff member was not found.', 404);
  if (error?.code === '23P01') return fail('This person already has an overlapping draft or published shift. Adjust the times or cancel the other shift.', 409);
  if (['40001', '55000', '23505'].includes(error?.code)) return fail('This shift has changed or was cancelled. Refresh the schedule before editing.', 409);
  if (error?.code === '22023') return fail('Check the shift dates, timezone, status and staff member.', 400);
  return fail('The schedule is temporarily unavailable. Please retry.', 503);
}
function readCursor(raw, binding) {
  if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid cursor');
  const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!value || typeof value !== 'object' || Object.entries(binding).some(([k, v]) => value[k] !== v)) throw new Error('Invalid cursor');
  return value;
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function orderedAfter(rows, cursor, key) {
  let previous = cursor ? key(cursor) : null;
  for (const row of rows) {
    const current = key(row);
    if (previous !== null && current <= previous) return false;
    previous = current;
  }
  return true;
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return fail('Unauthorized', 401);
    if (!['admin', 'developer'].includes(auth.userType)) return fail('Forbidden', 403);
    if (auth.overridesLoaded === false) return fail('Permissions are temporarily unavailable.', 503);
    const all = authCan(auth, 'attendance.view_all'), own = authCan(auth, 'attendance.view_own');
    const manage = all && authCan(auth, 'attendance.manage');
    const q = new URL(request.url).searchParams;
    const client = orgScopedClient(auth.token);
    const identity = { org: auth.orgId, actor: auth.appUserId, kind: auth.userType };
    if (q.get('view') === 'staff') {
      if (!manage) return fail('Forbidden', 403);
      const search = q.get('search') ?? '';
      if (search.length > 100) return fail('Staff search is too long.');
      const binding = { ...identity, search, view: 'staff' };
      let cursor = null;
      try {
        if (q.has('cursor')) {
          cursor = readCursor(q.get('cursor'), binding);
          if (!SHIFT_UUID.test(cursor.id || '') || !['admin', 'developer'].includes(cursor.type)) throw new Error();
        }
      } catch { return fail('Invalid staff cursor. Search again.'); }
      const { data, error } = await client.rpc('work_shift_staff', { p_search: search, p_after_type: cursor?.type ?? null, p_after_id: cursor?.id ?? null });
      if (error) return databaseFailure(error);
      if (!Array.isArray(data) || data.length > 51 || data.some(row => !SHIFT_UUID.test(row?.id || '') || !['admin', 'developer'].includes(row.user_type) || typeof row.name !== 'string')
          || !orderedAfter(data, cursor && { user_type: cursor.type, id: cursor.id }, row => `${row.user_type}:${row.id.toLowerCase()}`)) return databaseFailure();
      const staff = data.slice(0, 50), last = staff.at(-1);
      return reply({ success: true, staff, nextCursor: data.length > 50 ? encode({ ...binding, id: last.id, type: last.user_type }) : null });
    }
    if (q.has('view')) return fail('Invalid schedule view.');
    if (!all && !own) return fail('Forbidden', 403);
    const from = q.get('from'), to = q.get('to'), scope = q.get('scope') || 'me';
    if (!validReportDate(from) || !validReportDate(to) || from > to || Date.parse(to) - Date.parse(from) > 92 * 86400000) return fail('Choose a date range of up to 93 days.');
    if (!['me', 'all'].includes(scope)) return fail('Invalid schedule scope.');
    if ((scope === 'all' && !all) || (scope === 'me' && !own && !all)) return fail('Forbidden', 403);
    const binding = { ...identity, from, to, scope };
    let cursor = null;
    try {
      if (q.has('cursor')) {
        cursor = readCursor(q.get('cursor'), binding);
        if (!SHIFT_UUID.test(cursor.id || '') || !shiftInstant(cursor.start)) throw new Error();
      }
    } catch { return fail('Invalid schedule cursor. Refresh the list.'); }
    const start = `${from}T00:00:00.000Z`, end = new Date(Date.parse(to) + 86400000).toISOString();
    let requestQuery = client.from('work_shifts').select(COLUMNS, { count: 'exact' }).eq('organization_id', auth.orgId)
      .lt('start_at', end).gt('end_at', start).order('start_at').order('id').limit(50);
    if (scope === 'me') requestQuery = requestQuery.eq('user_id', auth.appUserId).eq('user_type', auth.userType);
    if (cursor) requestQuery = requestQuery.or(`start_at.gt.${shiftInstant(cursor.start)},and(start_at.eq.${shiftInstant(cursor.start)},id.gt.${cursor.id.toLowerCase()})`);
    const { data, error, count } = await requestQuery;
    if (error) return databaseFailure(error);
    if (!Array.isArray(data) || data.length > 50 || !Number.isSafeInteger(count) || count < data.length || (!data.length && count !== 0)
        || data.some(row => !validShiftRow(row, auth.orgId) || Date.parse(row.start_at) >= Date.parse(end) || Date.parse(row.end_at) <= Date.parse(start)
          || (scope === 'me' && (row.user_id !== auth.appUserId || row.user_type !== auth.userType)))
        || !orderedAfter(data, cursor && { start_at: cursor.start, id: cursor.id }, row => `${shiftInstant(row.start_at)}:${row.id.toLowerCase()}`)) return databaseFailure();
    const last = data.at(-1);
    return reply({ success: true, shifts: data, canManage: manage, canViewAll: all,
      nextCursor: count > data.length ? encode({ ...binding, start: shiftInstant(last.start_at), id: last.id }) : null });
  } catch { return databaseFailure(); }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return fail('Unauthorized', 401);
    if (auth.overridesLoaded === false) return fail('Permissions are temporarily unavailable.', 503);
    if (!['admin', 'developer'].includes(auth.userType) || !authCan(auth, 'attendance.manage') || !authCan(auth, 'attendance.view_all')) return fail('Forbidden', 403);
    let input;
    try { input = validateShiftInput(await request.json()); } catch (error) { return fail(error instanceof SyntaxError ? 'Invalid JSON.' : error.message); }
    const { data, error } = await orgScopedClient(auth.token).rpc('save_work_shift', {
      p_id: input.id, p_version: input.version, p_user_id: input.userId, p_user_type: input.userType,
      p_start: input.start, p_end: input.end, p_timezone: input.timezone, p_title: input.title, p_status: input.status, p_note: input.note,
    });
    if (error) return databaseFailure(error);
    const row = data?.shift;
    if (!validShiftRow(row, auth.orgId) || typeof data.unchanged !== 'boolean' || row.id !== input.id
        || row.user_id !== input.userId || row.user_type !== input.userType || row.version !== input.version + 1
        || shiftInstant(row.start_at) !== input.start || shiftInstant(row.end_at) !== input.end
        || row.title !== input.title || row.note !== input.note || row.status !== input.status || row.timezone !== input.timezone) return databaseFailure();
    return reply({ success: true, shift: row, unchanged: data.unchanged });
  } catch { return databaseFailure(); }
}
