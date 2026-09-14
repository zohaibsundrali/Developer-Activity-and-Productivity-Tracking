import { mobileAuth, mobileReply, mobileFail, mobileDatabaseError } from '@/utils/mobileServer';
import { readMobileJson, validWorkSite, mobileUuid } from '@/utils/mobileFieldTracking';
import { authCan } from '@/utils/serverPermissions';
export const dynamic = 'force-dynamic';
export async function POST(request) {
  try { const { auth, client, denied } = await mobileAuth(request); if (denied) return denied;
    if (!authCan(auth, 'attendance.manage') || !authCan(auth, 'attendance.view_all')) return mobileFail('Work-site management is not allowed.', 403);
    let value; try { value = await readMobileJson(request); } catch { return mobileFail('Invalid site request.'); }
    if (!value || !mobileUuid(value.id) || !Number.isSafeInteger(value.version) || value.version < 0 || value.version >= 2147483647 || !validWorkSite({ ...value, organization_id: auth.orgId, version: value.version + 1 }, auth.orgId)) return mobileFail('Check the site name, coordinates and radius (100–10,000 metres).');
    const { data, error } = await client.rpc('save_work_site', { p_id: value.id, p_version: value.version, p_name: value.name.trim(), p_lat: value.latitude, p_lon: value.longitude, p_radius: value.radius_m, p_active: value.active });
    if (error) return mobileDatabaseError(error);
    if (!validWorkSite(data, auth.orgId) || data.id !== value.id || data.version !== value.version + 1 || data.name !== value.name.trim() || ['latitude','longitude','radius_m','active'].some(key => data[key] !== value[key])) return mobileDatabaseError();
    return mobileReply({ success: true, site: data });
  } catch { return mobileDatabaseError(); }
}
