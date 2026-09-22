import {requirePlatformPermission,platformJson} from '@/utils/platformOwner';
import {stripeClient} from '@/utils/stripeServer';
import {isUuid} from '@/utils/workspaceIdentity';
const id=v=>typeof v==='string'?v:v?.id;
export async function POST(request) {
 try {
  const a=await requirePlatformPermission(request,'billing.manage');if(a.error)return a.error;
  const b=await request.json();if(!isUuid(b.organizationId)||!isUuid(b.requestId))return platformJson({error:'Invalid request.'},400);
  const c=await a.svc.rpc('platform_billing_context',{...a.args,p_org:b.organizationId,p_invoice:null});
  if(c.error)return platformJson({error:'Billing context unavailable.'},503);
  const original=c.data.requests?.find(r=>r.id===b.requestId);
  if(!original)return platformJson({error:'Original request not found.'},404);
  if(original.status==='completed')return platformJson(original.result);
  const stripe=stripeClient();if(!stripe)return platformJson({error:'Stripe is not configured.'},503);
  const sub=c.data.subscription,p=original.payload;
  const current=await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  if(id(current.customer)!==sub.stripe_customer_id)return platformJson({error:'Billing account mismatch.'},409);
  let result;
  if(p.action==='refund'){
   if(!/^re_[A-Za-z0-9]+$/.test(b.providerId||''))return platformJson({error:'Enter the Stripe refund ID from the provider dashboard.'},400);
   const invoiceContext=await a.svc.rpc('platform_billing_context',{...a.args,p_org:b.organizationId,p_invoice:p.invoiceId});
   const invoice=invoiceContext.data?.invoice;
   if(!invoice)return platformJson({error:'Invoice unavailable.'},409);
   const liveInvoice=await stripe.invoices.retrieve(invoice.stripe_invoice_id),refund=await stripe.refunds.retrieve(b.providerId);
   if(id(liveInvoice.customer)!==sub.stripe_customer_id||id(liveInvoice.subscription)!==sub.stripe_subscription_id||id(refund.payment_intent)!==id(liveInvoice.payment_intent)||refund.metadata?.platform_request_id!==original.id||refund.amount!==p.amountCents)return platformJson({error:'Refund does not prove this original request.'},409);
   result={id:refund.id,status:refund.status,amount:refund.amount,currency:refund.currency,created:refund.created,reconciled:true};
  }else{
   const matched=p.action==='cancel_subscription'?current.cancel_at_period_end===true:p.action==='extend_trial'?current.trial_end===Math.floor(Date.parse(p.trialEnd)/1000):p.action==='change_plan'&&current.items?.data?.length===1&&current.items.data[0].price.id===c.data.plans.find(x=>x.code===p.planCode)?.stripe_price_id;
   if(!matched)return platformJson({error:'Provider state does not match this request. Inspect the provider before retrying.'},409);
   result={id:current.id,status:current.status,reconciled:true,sync:'webhook_pending'};
  }
  const r=await a.svc.rpc('platform_billing_finish',{...a.args,p_request:original.id,p_result:result,p_success:true});
  return r.error?platformJson({error:'Verified provider result could not be recorded.'},503):platformJson(result);
 }catch{return platformJson({error:'Provider reconciliation failed.'},502);}
}
