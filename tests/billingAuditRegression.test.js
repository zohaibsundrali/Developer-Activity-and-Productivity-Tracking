import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { accessState } from '@/utils/billingAccess';
const state = vi.hoisted(() => ({ event: null, writes: [], configured: false, auth: { role: 'owner', userType: 'admin', orgId: '00000000-0000-0000-0000-000000000001' } }));
function db() {
  return { from(table) {
    let op = 'select', payload;
    const result = () => ({ error: null, data: op === 'select'
      ? table === 'billing_plans' ? [{ code: 'professional', name: 'Professional', amount_cents: 1000 }]
      : table === 'organization_subscriptions' ? [{ status: 'active' }] : []
      : [{ organization_id: state.auth.orgId }] });
    const q = { select: () => q, eq: () => q, limit: () => q, order: () => q,
      maybeSingle: async () => ({ ...result(), data: result().data[0] }),
      insert: p => { op = 'insert'; payload = p; state.writes.push({ table, op, payload }); return q; },
      update: p => { op = 'update'; payload = p; state.writes.push({ table, op, payload }); return q; },
      upsert: p => { op = 'upsert'; payload = p; state.writes.push({ table, op, payload }); return q; },
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    return q;
  } };
}
vi.mock('@/utils/serverAuth', () => ({ serviceClient: () => db(), getAuthedOrg: async () => state.auth }));
vi.mock('@/utils/systemEvents', () => ({ recordEvent: async () => {} }));
vi.mock('@/utils/stripeServer', async importOriginal => ({ ...(await importOriginal()), verifyWebhook: () => state.event, stripeClient: () => null, billingConfigured: () => state.configured }));
const { POST: webhook } = await import('@/app/api/billing/webhook/route');
const { POST: demo } = await import('@/app/api/billing/demo-activate/route');
const request = () => new Request('http://localhost/api/billing', { method: 'POST', body: JSON.stringify({ planCode: 'professional' }) });
beforeEach(() => { state.writes = []; state.configured = false; });
afterEach(() => vi.unstubAllEnvs());
describe('unpaid webhook cannot erase the subscription lock', () => {
  it.each(['unpaid', 'canceled'])('applies %s with the correct workspace access', async status => {
    state.event = { id: 'evt_1', type: 'customer.subscription.updated', created: 1800000000, data: { object: {
      id: 'sub_1', status, metadata: { organization_id: state.auth.orgId, plan_code: 'professional' }, items: { data: [] },
    } } };
    expect((await webhook(request())).status).toBe(200);
    const row = state.writes.find(w => w.table === 'organization_subscriptions' && w.op === 'upsert').payload;
    expect(row.plan_code).toBe(status === 'unpaid' ? 'professional' : 'free');
    expect(accessState(row).locked).toBe(status === 'unpaid');
  });
});
describe('production demo billing requires explicit configuration', () => {
  it('does not grant a free paid plan merely because Stripe is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BILLING_DEMO_ENABLED', '');
    expect((await demo(request())).status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });
  it('allows an explicitly configured demo installation', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BILLING_DEMO_ENABLED', 'true');
    expect((await demo(request())).status).toBe(200);
    expect(state.writes.some(w => w.table === 'organization_subscriptions')).toBe(true);
  });
});
