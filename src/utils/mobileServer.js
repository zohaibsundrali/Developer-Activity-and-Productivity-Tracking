import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { validWorkSite } from '@/utils/mobileFieldTracking';
export const mobileReply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } });
export const mobileFail = (error, status = 400) => mobileReply({ success: false, error }, status);
export function mobileDatabaseError(error) {
  if (error?.code === '42501') return mobileFail('Your mobile tracking access is not available.', 403);
  if (String(error?.message || '').startsWith('BILLING_LOCKED')) return mobileFail('Your subscription requires attention before work can sync.', 402);
  if (error?.code === '54000') return mobileFail('The organization has reached its 100 work-site limit.', 409);
  if (error?.code === '23P01') return mobileFail('This session overlaps recorded work. Keep the pending session and ask your manager to resolve the existing time.', 409);
  if (error?.code === '55000') return mobileFail('The timesheet week is locked. An approver must reopen it before this session can sync.', 409);
  if (['23505', '40001'].includes(error?.code)) return mobileFail('This record changed or its identifier was already used. Refresh before retrying.', 409);
  if (['22023', '22007', '22008', '22P02'].includes(error?.code)) return mobileFail('The session or site data is invalid. Sessions must sync within seven days.', 400);
  return mobileFail('Mobile tracking is temporarily unavailable. Keep pending data and retry.', 503);
}
export async function mobileAuth(request) {
  const auth = await getAuthedOrg(request);
  if (!auth) return { denied: mobileFail('Unauthorized', 401) };
  if (!['admin', 'developer'].includes(auth.userType)) return { denied: mobileFail('Forbidden', 403) };
  if (auth.overridesLoaded === false) return { denied: mobileFail('Permissions are temporarily unavailable.', 503) };
  return { auth, client: orgScopedClient(auth.token) };
}
export async function readMobileContext(client, auth) {
  const { data, error } = await client.rpc('mobile_work_context');
  if (error) return { denied: mobileDatabaseError(error) };
  if (!data || data.organization_id !== auth.orgId || data.user_id !== auth.appUserId || data.user_type !== auth.userType || typeof data.can_manage !== 'boolean' || typeof data.can_view_all !== 'boolean' || typeof data.can_record !== 'boolean'
    || !Array.isArray(data.sites) || data.sites.length > 100 || data.sites.some(site => !validWorkSite(site, auth.orgId)) || new Set(data.sites.map(site => site.id)).size !== data.sites.length) return { denied: mobileDatabaseError() };
  return { data };
}
