import { NextResponse } from 'next/server';
import { workspaceIdentity, isUuid } from '@/utils/workspaceIdentity';
export async function POST(request) {
  try {
    const auth = await workspaceIdentity(request);
    if (!auth) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    const body = await request.json();
    if (!isUuid(body?.organizationId) || !isUuid(body?.profileId) || !['admin', 'developer', 'client'].includes(body?.userType)) {
      return NextResponse.json({ error: 'Choose a valid organization.' }, { status: 400 });
    }
    const { data, error } = await auth.svc.rpc('select_workspace', {
      p_auth: auth.user.id, p_session: auth.sessionId, p_org: body.organizationId, p_profile: body.profileId, p_type: body.userType,
    });
    if (error || !data) return NextResponse.json({ error: error?.message?.startsWith('WORKSPACE_FORBIDDEN')
      ? 'You no longer have access to this organization.' : 'Workspace could not be opened. Please retry.' },
      { status: /^WORKSPACE_(FORBIDDEN|UNAUTHENTICATED)/.test(error?.message || '') ? 403 : 503 });
    return NextResponse.json({ context: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'Workspace could not be opened. Please retry.' }, { status: error instanceof SyntaxError ? 400 : 503 });
  }
}
