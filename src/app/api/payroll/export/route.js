import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { authCan } from '@/utils/serverPermissions';
import { validExportRange, validApprovedSnapshot, approvedTimeCsv } from '@/utils/approvedTimeExport';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' };
const fail = (error, status) => NextResponse.json({ success: false, error }, { status, headers });
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return fail('Unauthorized', 401);
    if (auth.overridesLoaded === false) return fail('Permissions are temporarily unavailable.', 503);
    if (!['admin', 'developer'].includes(auth.userType) || !authCan(auth, 'timesheet.view_all')) return fail('Forbidden', 403);
    const q = new URL(request.url).searchParams, from = q.get('from'), to = q.get('to');
    if (!validExportRange(from, to)) return fail('Choose Monday week-start dates covering up to 13 weeks.', 400);
    const { data, error } = await orgScopedClient(auth.token).rpc('approved_time_export', { p_from: from, p_to: to });
    if (error?.code === '42501') return fail('Export access is no longer available.', 403);
    if (error?.code === '54000') return fail('More than 10,000 approved weeks match. Choose a shorter period.', 413);
    if (error?.code === '55000') return fail('An approved timesheet needs its identity or approval record reviewed before export.', 409);
    if (error || !validApprovedSnapshot(data, auth.orgId, from, to)) return fail('Could not verify the complete export. Please retry.', 503);
    if (!data.count) return fail('No approved timesheets exist in these weeks.', 404);
    // Exclude capture time: unchanged source data gives the same fingerprint.
    const fingerprint = createHash('sha256').update(JSON.stringify([auth.orgId, from, to, data.rows])).digest('hex');
    return new Response(approvedTimeCsv(data, fingerprint), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="approved-time_${from}_${to}_${fingerprint.slice(0, 12)}.csv"`,
      'X-Export-Fingerprint': fingerprint, 'X-Export-Count': String(data.count) } });
  } catch { return fail('The approved-time export is temporarily unavailable.', 503); }
}
