import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
export const dynamic = 'force-dynamic';
async function context(request) {
  const auth = await getAuthedOrg(request);
  if (!auth) return { refusal: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const refusal = requirePermission(auth, 'organization.manage');
  if (refusal) return { refusal };
  if (auth.role !== 'owner' || auth.userType === 'client') return { refusal: NextResponse.json({ error: 'Retention is owner-only.' }, { status: 403 }) };
  return { auth, db: orgScopedClient(auth.token) };
}
function unavailable(error) {
  const status = error?.code === '42501' ? 403 : error?.code === '22023' ? 400 : 503;
  return NextResponse.json({ error: status === 400 ? 'Invalid policy or permanent deletion confirmation missing.' : 'Retention settings could not be verified. Please retry.' }, { status });
}
export async function GET(request) {
  try {
    const { auth, db, refusal } = await context(request); if (refusal) return refusal;
    const { data, error } = await db.rpc('get_tracking_retention', { p_org: auth.orgId });
    if (error || !data) return unavailable(error);
    return NextResponse.json(data);
  } catch { return unavailable(); }
}
export async function PATCH(request) {
  try {
    const { auth, db, refusal } = await context(request); if (refusal) return refusal;
    const body = await request.json().catch(() => null);
    if (!body || !['disabled','custom','plan'].includes(body.mode)
      || (body.mode === 'custom' && (!Number.isInteger(body.days) || body.days < 1 || body.days > 36500))
      || (body.mode !== 'custom' && body.days != null)
      || (body.mode !== 'disabled' && body.confirmPermanentDeletion !== true)) return unavailable({ code: '22023' });
    const { data, error } = await db.rpc('set_tracking_retention', { p_org: auth.orgId, p_mode: body.mode,
      p_days: body.mode === 'custom' ? body.days : null, p_confirm: body.confirmPermanentDeletion === true });
    if (error || !data) return unavailable(error);
    return NextResponse.json({ policy: data, inFlight: data.inFlight || 0 });
  } catch { return unavailable(); }
}
