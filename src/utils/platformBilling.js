import { isUuid } from '@/utils/workspaceIdentity';
export function validateBillingAction(body, now = Date.now()) {
  if (!body || !isUuid(body.organizationId) || !isUuid(body.requestId)) throw new Error('Organization and request IDs are required.');
  const reason = String(body.reason || '').trim();
  if (reason.length < 8 || reason.length > 500) throw new Error('Enter a reason between 8 and 500 characters.');
  const action = body.action;
  if (!['change_plan','extend_trial','cancel_subscription','refund'].includes(action)) throw new Error('Invalid billing action.');
  const value = { organizationId:body.organizationId, requestId:body.requestId, action, reason };
  if (action === 'change_plan') { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(body.planCode || '')) throw new Error('Select a plan.'); value.planCode = body.planCode; }
  if (action === 'extend_trial') { const end = Date.parse(body.trialEnd); if (!Number.isFinite(end) || end <= now || end > now + 365*86400000) throw new Error('Trial end must be within the next year.'); value.trialEnd = new Date(end).toISOString(); }
  if (action === 'refund') { if (!isUuid(body.invoiceId) || !Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) throw new Error('Select an invoice and a positive refund amount in minor units.'); value.invoiceId = body.invoiceId; value.amountCents = body.amountCents; }
  return value;
}
function billingValidation(message) { const error = new Error(message); error.billingValidation = true; return error; }
const id = value => typeof value === 'string' ? value : value?.id;
export async function executeBillingAction(stripe, context, body) {
  const sub = context.subscription;
  if (!sub?.stripe_customer_id || !sub?.stripe_subscription_id) throw billingValidation('This action requires a Stripe-backed subscription.');
  const options = { idempotencyKey: `platform-billing-${body.requestId}` };
  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  if (id(current.customer) !== sub.stripe_customer_id) throw billingValidation('Subscription customer does not match the billing account.');
  if (body.action === 'refund') {
    if (!context.invoice?.stripe_invoice_id || context.invoice.organization_id !== context.billingOrganizationId) throw billingValidation('Invoice does not belong to this billing account.');
    const invoice = await stripe.invoices.retrieve(context.invoice.stripe_invoice_id);
    if (id(invoice.customer) !== sub.stripe_customer_id || id(invoice.subscription) !== sub.stripe_subscription_id || invoice.status !== 'paid') throw billingValidation('Invoice is not a paid invoice for this subscription.');
    if (body.amountCents > invoice.amount_paid || !id(invoice.payment_intent)) throw billingValidation('Refund exceeds payment or invoice has no refundable payment.');
    const refund = await stripe.refunds.create({ payment_intent:id(invoice.payment_intent), amount:body.amountCents, metadata:{platform_request_id:body.requestId,organization_id:context.billingOrganizationId} },options);
    return {id:refund.id,status:refund.status,amount:refund.amount,currency:refund.currency,created:refund.created};
  }
  let patch;
  if (body.action === 'cancel_subscription') patch = {cancel_at_period_end:true};
  if (body.action === 'extend_trial') {
    const end = Math.floor(Date.parse(body.trialEnd)/1000);
    if (current.status !== 'trialing' || end <= (current.trial_end || 0)) throw billingValidation('Only an existing trial can be extended beyond its current end.');
    patch = {trial_end:end,proration_behavior:'none'};
  }
  if (body.action === 'change_plan') {
    const plan = context.plans.find(p=>p.code===body.planCode);
    if (!plan?.stripe_price_id || current.items?.data?.length !== 1) throw billingValidation('Select a configured plan; multi-item subscriptions require provider review.');
    patch = {items:[{id:current.items.data[0].id,price:plan.stripe_price_id,quantity:current.items.data[0].quantity || 1}],proration_behavior:'none',payment_behavior:'error_if_incomplete',metadata:{plan_code:plan.code}};
  }
  const result = await stripe.subscriptions.update(current.id,patch,options);
  return {id:result.id,status:result.status,cancel_at_period_end:result.cancel_at_period_end,trial_end:result.trial_end,sync:'webhook_pending'};
}
