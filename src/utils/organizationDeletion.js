import { stripeClient } from '@/utils/stripeServer';

// Cleanup retries are owned by the durable job ledger. A single SDK request
// must not spend the default 80 seconds plus automatic retries in this worker.
const billingRequestOptions = { timeout: 10_000, maxNetworkRetries: 0 };

async function rpc(svc, name, args) {
  const result = await svc.rpc(name, args);
  if (result.error) throw new Error('Organization cleanup operation failed');
  return result.data;
}
async function cancelBilling(svc, job) {
  if (!job.stripe_customer_id && !job.stripe_subscription_id) return;
  if (!job.stripe_customer_id) throw new Error('Billing identity requires repair');
  const stripe = stripeClient();
  if (!stripe) throw new Error('Billing provider unavailable');
  const shared = await svc.from('organization_subscriptions').select('organization_id').eq('stripe_customer_id', job.stripe_customer_id).neq('organization_id', job.organization_id).limit(1);
  if (shared.error || shared.data?.length) throw new Error('Billing customer is shared');
  const customer = await stripe.customers.retrieve(job.stripe_customer_id, {}, billingRequestOptions);
  if (customer.deleted || customer.metadata?.organization_id !== job.organization_id) throw new Error('Billing customer identity mismatch');
  // An already-issued hosted session must not create a fresh subscription
  // after workspace access is frozen. Verify tenant identity before expiring.
  let checkoutCursor;
  do {
    const page = await stripe.checkout.sessions.list({ customer: job.stripe_customer_id, status: 'open', limit: 100, ...(checkoutCursor ? { starting_after: checkoutCursor } : {}) }, billingRequestOptions);
    for (const session of page.data) {
      if (session.metadata?.organization_id !== job.organization_id || (typeof session.customer === 'string' ? session.customer : session.customer?.id) !== job.stripe_customer_id)
        throw new Error('Checkout identity mismatch');
      const expired = await stripe.checkout.sessions.expire(session.id, {}, billingRequestOptions);
      if (expired.status !== 'expired') throw new Error('Checkout expiration not confirmed');
    }
    if (page.has_more && !page.data.length) throw new Error('Incomplete checkout listing');
    checkoutCursor = page.has_more ? page.data.at(-1).id : null;
  } while (checkoutCursor);
  const subscriptions = []; let cursor;
  do {
    const page = await stripe.subscriptions.list({ customer: job.stripe_customer_id, status: 'all', limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, billingRequestOptions);
    for (const sub of page.data) {
      if ((typeof sub.customer === 'string' ? sub.customer : sub.customer?.id) !== job.stripe_customer_id || sub.metadata?.organization_id !== job.organization_id)
        throw new Error('Subscription identity mismatch');
      subscriptions.push(sub);
    }
    if (page.has_more && !page.data.length) throw new Error('Incomplete subscription listing');
    cursor = page.has_more ? page.data.at(-1).id : null;
  } while (cursor);
  if (job.stripe_subscription_id && !subscriptions.some(sub => sub.id === job.stripe_subscription_id)) throw new Error('Stored subscription was not verified');
  for (const sub of subscriptions) {
    if (['canceled', 'incomplete_expired'].includes(sub.status)) continue;
    const cancelled = await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }, billingRequestOptions);
    if (cancelled.status !== 'canceled') throw new Error('Subscription cancellation not confirmed');
  }
}

/** A bounded leased step, suitable for cron and explicit owner retries. External
 * operations use supported APIs; the ledger acknowledges only confirmed work. */
async function processDeletionStep(svc, { orgId = null, retry = false } = {}) {
  const job = await rpc(svc, 'claim_organization_deletion', { p_org: orgId, p_retry: retry });
  if (!job) return { processed: false };
  const base = { p_job: job.id, p_lease: job.lease };
  const finish = args => rpc(svc, 'finish_organization_deletion_step', { ...base, ...args });
  try {
    if (job.stage === 'billing') {
      await cancelBilling(svc, job);
      await finish({ p_stage: 'storage' });
    } else if (job.stage === 'storage' || job.stage === 'auth') {
      const items = await rpc(svc, 'organization_deletion_items', { ...base, p_kind: job.stage });
      for (const item of items) {
        if (job.stage === 'storage') {
          const args = { ...base, p_item: item.id };
          const before = await rpc(svc, 'check_deletion_storage_item', args);
          if (before === 'present') {
            const removed = await svc.storage.from(item.bucket).remove([item.path]);
            if (removed.error) throw new Error('Storage removal failed');
          } else if (before !== 'absent') throw new Error('Storage identity not verified');
          if (await rpc(svc, 'check_deletion_storage_item', args) !== 'absent') throw new Error('Storage removal not confirmed');
          await finish({ p_item: item.id });
        } else {
          const result = await svc.auth.admin.getUserById(item.resource_id);
          if (result.error && ![404, '404'].includes(result.error.status)) throw new Error('Auth lookup unavailable');
          if (!result.data?.user) {
            if (!result.error || ![404, '404'].includes(result.error.status)) throw new Error('Auth absence not confirmed');
            await finish({ p_item: item.id }); continue;
          }
          const user = result.data.user; const meta = user.app_metadata || {};
          const valid = user.id === item.resource_id && meta.organization_id === job.organization_id && meta.app_user_id === item.profile_id && meta.user_type === item.profile_type && (!item.invitation_id || meta.invitation_id === item.invitation_id)
            && await rpc(svc, 'check_deletion_auth_identity', { ...base, p_item: item.id });
          if (!valid) { await finish({ p_item: item.id, p_retained: true }); continue; }
          const removed = await svc.auth.admin.deleteUser(item.resource_id);
          if (removed.error && ![404, '404'].includes(removed.error.status)) throw new Error('Auth removal failed');
          const check = await svc.auth.admin.getUserById(item.resource_id);
          if (!check.error || ![404, '404'].includes(check.error.status)) throw new Error('Auth removal not confirmed');
          await finish({ p_item: item.id });
        }
      }
      const remaining = await rpc(svc, 'organization_deletion_items', { ...base, p_kind: job.stage });
      await finish({ p_stage: remaining.length ? job.stage : job.stage === 'storage' ? 'auth' : 'database' });
    } else if (job.stage === 'database') {
      await cancelBilling(svc, job);
      await rpc(svc, 'finalize_organization_deletion', base);
    } else throw new Error('Unknown cleanup stage');
    return { processed: true, jobId: job.id, stage: job.stage };
  } catch {
    await finish({ p_error: true });
    return { processed: true, jobId: job.id, retry: true };
  }
}

/** Bound provider work per request; each completed step releases its lease. */
export async function processOrganizationDeletion(svc, { orgId = null, retry = false, maxSteps = 4, timeBudgetMs = 15000 } = {}) {
  const started = Date.now(); let processed = 0; let last = { processed: false };
  for (let step = 0; step < Math.max(1, Math.min(maxSteps, 4)); step += 1) {
    if (step > 0 && Date.now() - started >= timeBudgetMs) break;
    last = await processDeletionStep(svc, { orgId, retry });
    if (!last.processed) break;
    processed += 1;
    if (last.retry || last.stage === 'database') break;
  }
  return { ...last, processed: processed > 0, steps: processed };
}
