import { requirePlatformPermission, platformJson, platformPage } from '@/utils/platformOwner';
import { platformFilters, applyPlatformFilters } from '@/utils/platformFilters';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const access = await requirePlatformPermission(request, 'billing.read'); if (access.error) return access.error;
    const search = new URL(request.url).searchParams, page = platformPage(search);
    if (!page) return platformJson({ error: 'Invalid page.' }, 400);
    const filters = platformFilters(search);
    if (!filters) return platformJson({ error: 'Invalid filters.' }, 400);
    const invoices = search.get('tab') === 'invoices';
    let query = access.svc.from(invoices ? 'billing_invoices' : 'organization_subscriptions')
      .select(invoices ? 'id,organization_id,status,currency,amount_paid_cents,amount_due_cents,created_at,organizations(name)' : 'id,organization_id,plan_code,status,current_period_end,cancel_at_period_end,last_payment_status,created_at,organizations(name)', { count: 'exact' });
    query = applyPlatformFilters(query, filters);
    const result = await query.order('created_at', { ascending: false }).order('id').range((page-1)*20,page*20-1);
    if (result.error) return platformJson({ error: 'Billing records unavailable.' }, 503);
    return platformJson({ items: result.data, total: result.count, page, pageSize:20 });
  } catch { return platformJson({ error: 'Billing records unavailable.' }, 503); }
}
