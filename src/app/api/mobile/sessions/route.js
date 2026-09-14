import { mobileAuth, mobileReply, mobileFail, mobileDatabaseError } from '@/utils/mobileServer';
import { readMobileJson, validateMobilePayload } from '@/utils/mobileFieldTracking';
import { authCan } from '@/utils/serverPermissions';
export const dynamic = 'force-dynamic';
export async function POST(request) {
  try { const { auth, client, denied } = await mobileAuth(request); if (denied) return denied;
    if (!authCan(auth, 'timesheet.log_own') || !authCan(auth, 'attendance.view_own')) return mobileFail('Mobile work recording is not allowed.', 403);
    let validated; try { validated = validateMobilePayload(await readMobileJson(request)); } catch (e) { return mobileFail(e instanceof SyntaxError ? 'Invalid session JSON.' : e.message); }
    const { data, error } = await client.rpc('upload_mobile_work', { p_payload: validated.payload });
    if (error) return mobileDatabaseError(error);
    if (!data || data.id !== validated.payload.id || data.organization_id !== auth.orgId || data.user_id !== auth.appUserId || data.user_type !== auth.userType || data.work_seconds !== validated.seconds || typeof data.unchanged !== 'boolean') return mobileDatabaseError();
    return mobileReply({ success: true, ...data });
  } catch { return mobileDatabaseError(); }
}
