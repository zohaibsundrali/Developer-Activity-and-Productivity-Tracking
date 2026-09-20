import { createHash, randomBytes } from 'node:crypto';
import { requirePlatformOwner, platformJson, platformPage } from '@/utils/platformOwner';
import { isUuid } from '@/utils/workspaceIdentity';
import { processOrganizationDeletion } from '@/utils/organizationDeletion';
export const dynamic = 'force-dynamic';
const lists = {
  projects: { table: 'projects', columns: 'id,name,status,created_at' },
  members: { table: 'memberships', columns: 'id,email,role,user_type,status,created_at' },
  invoices: { table: 'billing_invoices', columns: 'id,status,currency,amount_paid_cents,amount_due_cents,issued_at,created_at' },
};
async function accessFor(request, context) {
  const access = await requirePlatformOwner(request);
  if (access.error) return access;
  const { id } = await context.params;
  if (!isUuid(id)) return { error: platformJson({ error: 'Invalid organization.' }, 400) };
  return { ...access, id };
}
export async function GET(request, context) {
  try {
    const access = await accessFor(request, context); if (access.error) return access.error;
    const search = new URL(request.url).searchParams;
    const detail = await access.svc.rpc('platform_organization_detail', { ...access.args, p_org: access.id });
    if (detail.error) return platformJson({ error: 'Organization details unavailable.' }, detail.error.code === '42501' ? 403 : 503);
    if (!detail.data) return platformJson({ error: 'Organization not found.' }, 404);
    const tab = search.get('tab');
    if (!tab) return platformJson(detail.data);
    const list = lists[tab], page = platformPage(search);
    if (!list || !page) return platformJson({ error: 'Invalid list or page.' }, 400);
    const result = await access.svc.from(list.table).select(list.columns, { count: 'exact' })
      .eq('organization_id', tab === 'invoices' ? detail.data.billingOrganizationId : access.id)
      .order('created_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1);
    if (result.error) return platformJson({ error: 'Organization records unavailable.' }, 503);
    return platformJson({ items: result.data, total: result.count, page, pageSize: 20 });
  } catch { return platformJson({ error: 'Organization details unavailable.' }, 503); }
}
export async function DELETE(request, context) {
  try {
    const access = await accessFor(request, context); if (access.error) return access.error;
    const body = await request.json().catch(() => null);
    if (typeof body?.confirmName !== 'string' || body.confirmName.length > 200 || typeof body.reason !== 'string' || body.reason.trim().length < 8 || body.reason.length > 500)
      return platformJson({ error: 'Enter the exact organization name and a reason of 8–500 characters.' }, 400);
    const result = await access.svc.rpc('platform_start_deletion', { ...access.args, p_org: access.id, p_name: body.confirmName, p_reason: body.reason.trim(), p_receipt_hash: createHash('sha256').update(randomBytes(32)).digest('hex') });
    if (result.error) {
      const code = result.error.code;
      return platformJson({ error: result.error.message?.startsWith('SHARED_BILLING_ACCOUNT:') ? 'Delete the other workspaces on this billing account first.' : code === '22023' ? 'Check the exact name. Storage ownership or an in-progress invitation may also require attention.' : code === '42501' ? 'Platform-owner access required.' : 'Deletion could not start. Check provisioning and retry.' }, code === '42501' ? 403 : ['22023','23503','55000'].includes(code) ? 409 : 503);
    }
    return platformJson({ jobId: result.data, message: 'Deletion queued. Billing, storage and account cleanup will run through the recorded job.' }, 202);
  } catch { return platformJson({ error: 'Deletion could not start.' }, 503); }
}
export async function PATCH(request, context) {
  try {
    const access = await accessFor(request, context); if (access.error) return access.error;
    const check = await access.svc.rpc('platform_retry_deletion', { ...access.args, p_org: access.id });
    if (check.error) return platformJson({ error: 'Cleanup retry unavailable.' }, check.error.code === '42501' ? 403 : 503);
    if (!check.data) return platformJson({ error: 'No pending cleanup exists.' }, 404);
    await processOrganizationDeletion(access.svc, { orgId: access.id, retry: true });
    return platformJson({ message: 'Cleanup step processed. Refresh the job status for the result.' });
  } catch { return platformJson({ error: 'Cleanup could not progress. The job remains retryable.' }, 503); }
}
