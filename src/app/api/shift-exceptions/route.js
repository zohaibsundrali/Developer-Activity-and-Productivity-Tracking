import { mobileAuth, mobileReply, mobileFail } from '@/utils/mobileServer';
import { authCan } from '@/utils/serverPermissions';
import { validReportDate } from '@/utils/reportDates';
import { SHIFT_UUID, shiftInstant } from '@/utils/workShifts';
import { classifyShiftAttendance, exceptionGrace } from '@/utils/shiftAttendanceExceptions';
import { readMobileJson } from '@/utils/mobileFieldTracking';
export const dynamic = 'force-dynamic';
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const decisions = ['acknowledged','excused','reopened'];
function failure(error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === 'P0002' ? 404 : code === '22023' ? 400 : ['40001','23505','54000'].includes(code) ? 409 : String(error?.message).startsWith('BILLING_LOCKED') ? 402 : 503;
  return mobileFail(code === '54000' ? 'This report exceeds the 500-shift or evidence-size limit. Select a shorter date range.' : status === 409 ? 'The evidence changed. Refresh before reviewing again.' : status === 403 ? 'Attendance exception access is not allowed.' : status === 400 ? 'Check the report dates, grace minutes and review fields.' : 'Attendance exceptions are temporarily unavailable.', status);
}
const validReview = (r, org, id) => r && SHIFT_UUID.test(r.id) && r.organization_id === org && r.shift_id === id && fingerprint(r.fingerprint) && exceptionGrace(r.late_grace) && exceptionGrace(r.early_grace) && decisions.includes(r.decision) && typeof r.reason === 'string' && r.reason.length <= 1000 && SHIFT_UUID.test(r.actor_id) && ['admin','developer'].includes(r.actor_type) && shiftInstant(r.created_at);
export async function GET(request) {
  try {
    const { auth, client, denied } = await mobileAuth(request); if (denied) return denied;
    const q = new URL(request.url).searchParams, from = q.get('from'), to = q.get('to'), scope = q.get('scope') || 'me';
    const rawLate = q.get('late'), rawEarly = q.get('early'), late = Number(rawLate), early = Number(rawEarly);
    if (!validReportDate(from) || !validReportDate(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000 || !['me','all'].includes(scope)
        || !/^\d{1,3}$/.test(rawLate || '') || !/^\d{1,3}$/.test(rawEarly || '') || !exceptionGrace(late) || !exceptionGrace(early)) return mobileFail('Select up to 31 UTC start dates and grace minutes from 0 to 120.');
    if (!authCan(auth, scope === 'all' ? 'attendance.view_all' : 'attendance.view_own')) return mobileFail('Forbidden', 403);
    const { data, error } = await client.rpc('shift_attendance_report', { p_from: from, p_to: to, p_scope: scope, p_late: late, p_early: early });
    if (error) return failure(error);
    if (!data || data.organization_id !== auth.orgId || data.from !== from || data.to !== to || data.scope !== scope || data.late_grace !== late || data.early_grace !== early || !shiftInstant(data.as_of) || typeof data.can_manage !== 'boolean' || !Array.isArray(data.rows) || data.rows.length > 500) return failure();
    const ids = new Set();
    const rows = data.rows.map(row => {
      const s = row?.snapshot?.shift;
      if (!s || s.organization_id !== auth.orgId || !SHIFT_UUID.test(s.user_id) || !['admin','developer'].includes(s.user_type) || typeof s.assignee_name !== 'string' || typeof s.title !== 'string' || (scope === 'me' && (s.user_id !== auth.appUserId || s.user_type !== auth.userType)) || !fingerprint(row.fingerprint) || !Array.isArray(row.reviews) || row.reviews.length > 20 || row.reviews.some(r => !validReview(r, auth.orgId, s.id)) || ids.has(s.id) || Date.parse(s.start_at) < Date.parse(from) || Date.parse(s.start_at) >= Date.parse(to) + 86400000 || Date.parse(s.end_at) > Date.parse(data.as_of)) throw new Error();
      ids.add(s.id); const classification = classifyShiftAttendance(row.snapshot, late, early);
      const latest = row.reviews[0] || null;
      return { ...row, classification, review_state: !latest ? 'unreviewed' : latest.fingerprint !== row.fingerprint ? 'evidence_changed' : latest.decision };
    });
    return mobileReply({ success: true, ...data, rows });
  } catch { return failure(); }
}
export async function POST(request) {
  try {
    const { auth, client, denied } = await mobileAuth(request); if (denied) return denied;
    if (!authCan(auth, 'attendance.manage') || !authCan(auth, 'attendance.view_all')) return mobileFail('Review requires attendance management access.', 403);
    let b; try { b = await readMobileJson(request); } catch { return mobileFail('Invalid review.'); }
    if (!b || !SHIFT_UUID.test(b.id || '') || !SHIFT_UUID.test(b.shiftId || '') || !fingerprint(b.fingerprint) || !exceptionGrace(b.late) || !exceptionGrace(b.early) || !decisions.includes(b.decision) || typeof b.reason !== 'string' || !b.reason.trim() || b.reason.trim().length > 1000 || Object.keys(b).some(k => !['id','shiftId','fingerprint','late','early','decision','reason'].includes(k))) return mobileFail('Select a review decision and enter a reason (up to 1,000 characters).');
    const { data, error } = await client.rpc('review_shift_attendance', { p_id: b.id, p_shift: b.shiftId, p_fingerprint: b.fingerprint, p_late: b.late, p_early: b.early, p_decision: b.decision, p_reason: b.reason.trim() });
    if (error) return failure(error);
    if (!validReview(data, auth.orgId, b.shiftId) || data.id !== b.id || data.fingerprint !== b.fingerprint || data.decision !== b.decision || data.reason !== b.reason.trim() || data.actor_id !== auth.appUserId || data.actor_type !== auth.userType || data.late_grace !== b.late || data.early_grace !== b.early) return failure();
    return mobileReply({ success: true, review: data });
  } catch { return failure(); }
}
