import { requirePlatformPermission, platformJson } from '@/utils/platformOwner';
import { stripeClient, stripeMode } from '@/utils/stripeServer';
import { validateBillingAction, executeBillingAction } from '@/utils/platformBilling';
import { isUuid } from '@/utils/workspaceIdentity';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const access = await requirePlatformPermission(request,'billing.read'); if (access.error) return access.error;
    const org = new URL(request.url).searchParams.get('organizationId');
    if (!isUuid(org)) return platformJson({error:'Invalid organization.'},400);
    const result = await access.svc.rpc('platform_billing_context',{...access.args,p_org:org,p_invoice:null});
    if (result.error) return platformJson({error:'Billing context unavailable.'},503);
    return platformJson({...result.data,mode:stripeMode()});
  } catch { return platformJson({error:'Billing context unavailable.'},503); }
}
export async function POST(request) {
  let access, body, reserved = false;
  try {
    access = await requirePlatformPermission(request,'billing.manage'); if (access.error) return access.error;
    try { body = validateBillingAction(await request.json()); } catch(e) { return platformJson({error:e.message},400); }
    const stripe = stripeClient();
    const context = await access.svc.rpc('platform_billing_context',{...access.args,p_org:body.organizationId,p_invoice:body.invoiceId || null});
    if (context.error || !context.data) return platformJson({error:'Billing account unavailable.'},404);
    const localTrial = body.action === 'extend_trial' && !context.data.subscription?.stripe_subscription_id;
    if (!stripe && !localTrial) return platformJson({error:'Stripe is not configured.'},503);
    const begin = await access.svc.rpc('platform_billing_begin',{...access.args,p_request:body.requestId,p_org:body.organizationId,p_payload:body});
    if (begin.error) return platformJson({error:'Request is busy, expired, or conflicts with a previous request. Use its original details or review the audit log.'},409);
    if (begin.data?.status === 'completed') return platformJson(begin.data.result);
    reserved = true;
    if (localTrial && (context.data.subscription?.status !== 'trialing' || Date.parse(body.trialEnd) <= Date.parse(context.data.subscription.trial_end || new Date().toISOString()))) { const e = new Error('Only an existing trial can be extended.'); e.billingValidation = true; throw e; }
    const result = localTrial ? {status:'trialing',trial_end:body.trialEnd,local:true} : await executeBillingAction(stripe,context.data,body);
    const finish = await access.svc.rpc('platform_billing_finish',{...access.args,p_request:body.requestId,p_result:result,p_success:true});
    if (finish.error) return platformJson({error:localTrial ? 'Trial could not be extended. Only an existing trial can be extended beyond its current end.' : 'Provider accepted the action but recording needs retry. Retry with the same request ID.',requestId:body.requestId},503);
    return platformJson(result);
  } catch(e) {
    if (reserved) { try { await access.svc.rpc('platform_billing_finish',{...access.args,p_request:body.requestId,p_result:{error:'Billing action failed; review provider state before retry.',retryable:!e.billingValidation},p_success:false}); } catch { /* Preserve pending receipt when audit storage is unavailable. */ } }
    return platformJson({error:'Billing action could not complete. Check the subscription, invoice and provider configuration; retry with the same request ID.',requestId:body?.requestId},502);
  }
}
