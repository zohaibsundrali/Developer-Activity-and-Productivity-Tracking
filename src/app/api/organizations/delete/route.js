import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
import { processOrganizationDeletion } from '@/utils/organizationDeletion';
export const dynamic = 'force-dynamic';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (value, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
async function owner(request) {
  const auth = await getAuthedOrg(request, { allowDeletion: true });
  if (!auth) return { error: json({ error: 'Unauthorized' }, 401) };
  if (auth.role !== 'owner' || !['admin', 'developer'].includes(auth.userType)) return { error: json({ error: 'Only the organization owner can delete it.' }, 403) };
  const denied = requirePermission(auth, 'organization.delete');
  return denied ? { error: denied } : { auth };
}
async function status(svc, args) {
  const res = await svc.rpc('organization_deletion_status', args);
  if (res.error) throw new Error('Deletion status unavailable');
  return res.data;
}
export async function GET(request) {
  try {
    const receipt = new URL(request.url).searchParams.get('receipt');
    const svc = serviceClient();
    if (receipt !== null) {
      if (!/^[0-9a-f]{64}$/.test(receipt)) return json({ error: 'Invalid receipt.' }, 404);
      const job = await status(svc, { p_receipt_hash: hash(receipt) });
      return job ? json({ job, organizationName: job.organizationName, canDelete: false }) : json({ error: 'Receipt not found.' }, 404);
    }
    const access = await owner(request); if (access.error) return access.error;
    const job = await status(svc, { p_org: access.auth.orgId, p_auth: access.auth.userId });
    if (job) return json({ job, organizationName: job.organizationName, canDelete: true });
    const org = await svc.from('organizations').select('name').eq('id', access.auth.orgId).maybeSingle();
    if (org.error || !org.data) throw new Error('Organization unavailable');
    return json({ job: null, organizationName: org.data.name, canDelete: true });
  } catch { return json({ error: 'Deletion status is unavailable.' }, 503); }
}
export async function POST(request) {
  try {
    const access = await owner(request); if (access.error) return access.error;
    const body = await request.json().catch(() => null);
    if (typeof body?.confirmName !== 'string') return json({ error: 'Confirm the exact organization name.' }, 400);
    const svc = serviceClient(); const receiptToken = randomBytes(32).toString('hex');
    const started = await svc.rpc('start_organization_deletion', { p_org: access.auth.orgId, p_actor: access.auth.appUserId, p_type: access.auth.userType, p_auth: access.auth.userId, p_name: body.confirmName, p_receipt_hash: hash(receiptToken) });
    if (started.error) return json({ error: started.error.code === '22023' ? 'Name confirmation or storage ownership needs verification before deletion.' : 'Could not start organization deletion.' }, started.error.code === '42501' ? 403 : started.error.code === '22023' ? 400 : 503);
    // Return the receipt before external deletion; cron or explicit retry makes
    // progress even if the browser disconnects after receiving this response.
    const job = await status(svc, { p_receipt_hash: hash(receiptToken) });
    return json({ job, organizationName: job?.organizationName, canDelete: true, receiptToken }, 202);
  } catch { return json({ error: 'Could not start organization deletion.' }, 503); }
}
export async function PATCH(request) {
  try {
    const access = await owner(request); if (access.error) return access.error;
    const svc = serviceClient();
    const existing = await status(svc, { p_org: access.auth.orgId, p_auth: access.auth.userId });
    if (!existing) return json({ error: 'No deletion job exists.' }, 404);
    await processOrganizationDeletion(svc, { orgId: access.auth.orgId, retry: true });
    const job = await status(svc, { p_org: access.auth.orgId, p_auth: access.auth.userId });
    return json({ job, organizationName: job?.organizationName, canDelete: true });
  } catch { return json({ error: 'Cleanup could not progress. The recorded job remains retryable.' }, 503); }
}
