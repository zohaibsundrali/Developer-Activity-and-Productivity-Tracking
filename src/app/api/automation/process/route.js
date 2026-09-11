import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient, orgScopedClient } from '@/utils/serverAuth';
import { checkFeatureAccess } from '@/utils/entitlements';
import { processActorAutomations } from '@/utils/automationProcessor';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'developer'].includes(auth.userType)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
      (body.retryFailed !== undefined && typeof body.retryFailed !== 'boolean')) return NextResponse.json({ error: 'Invalid retry request' }, { status: 400 });
    const svc = serviceClient();
    const gate = await checkFeatureAccess(svc, auth.orgId, 'automation', 'Automation');
    if (gate) return NextResponse.json(gate, { status: gate.status });
    const result = await processActorAutomations({ auth, svc, caller: orgScopedClient(auth.token), retryFailed: body.retryFailed === true });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Automation processing failed:', error?.code || 'unknown');
    return NextResponse.json({ error: 'Automation processing is unavailable. Pending work remains queued.' }, { status: 503 });
  }
}
