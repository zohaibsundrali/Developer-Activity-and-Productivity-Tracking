import { beforeEach, describe, expect, it, vi } from 'vitest';
import { billingScope, billingAuthority } from '@/utils/accountBilling';
import { resolveEntitlement, RESOURCES } from '@/utils/entitlements';
const scope = { accountId: 'original', ownerAuthId: 'payer', organizationIds: ['original', 'second'] };
const state = vi.hoisted(() => ({}));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => state.svc }));
vi.mock('@/utils/serverPermissions', () => ({ requirePermission: () => null }));
vi.mock('@/utils/stripeServer', () => ({ billingConfigured: () => true, appOrigin: () => 'https://example.test', stripeClient: () => state.stripe }));
import { POST as portal } from '@/app/api/billing/portal/route';

beforeEach(() => {
  state.auth = { orgId: 'second', userId: 'payer' };
  state.filters = [];
  state.svc = {
    rpc: vi.fn(async name => name === 'billing_scope' ? { data: scope } : { data: false }),
    from: table => {
      const q = { select: () => q, eq: (key, value) => { state.filters.push([table, key, value]); return q; },
        in: (key, value) => { state.filters.push([table, key, value]); return q; }, neq: () => q,
        maybeSingle: async () => ({ data: table === 'billing_plans' ? { code: 'professional', limits: { projects: 2 } } : { plan_code: 'professional', status: 'active', stripe_customer_id: 'cus_account' } }),
        then: (resolve, reject) => Promise.resolve({ count: 2 }).then(resolve, reject) };
      return q;
    },
  };
  state.stripe = { customers: { retrieve: vi.fn(async () => ({ metadata: { organization_id: 'original' } })) },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://billing.test/account' })) } } };
});
const request = () => new Request('https://example.test/api/billing/portal', { method: 'POST' });

describe('shared account boundary', () => {
  it('resolves the single subscription from a secondary workspace', async () => {
    expect((await resolveEntitlement(state.svc, 'second')).planCode).toBe('professional');
    expect(state.filters).toContainEqual(['organization_subscriptions', 'organization_id', 'original']);
  });
  it('counts resources across the account instead of only the selected workspace', async () => {
    expect(await RESOURCES.projects.count(state.svc, 'second')).toEqual({ count: 2 });
    expect(state.filters).toContainEqual(['projects', 'organization_id', ['original', 'second']]);
  });
  it.each([null, {}, { ...scope, organizationIds: ['original'] }])('rejects missing/foreign account scope', async data => {
    state.svc.rpc.mockResolvedValue({ data });
    await expect(billingScope(state.svc, 'second')).rejects.toThrow('Account billing lookup unavailable');
  });
  it('uses the original Stripe customer from a secondary workspace', async () => {
    expect((await portal(request())).status).toBe(200);
    expect(state.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_account' }));
    expect(state.filters).toContainEqual(['organization_subscriptions', 'organization_id', 'original']);
  });
  it('does not let a different workspace owner spend the billing payer’s money', async () => {
    state.auth.userId = 'different-owner';
    expect((await portal(request())).status).toBe(403);
    expect(state.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
  it('does not expose account invoices to a secondary workspace finance role', async () => {
    expect((await billingAuthority(state.svc, { orgId: 'second', userId: 'finance' })).denied).toBe(true);
    expect((await billingAuthority(state.svc, { orgId: 'original', userId: 'finance' })).denied).toBe(false);
  });
  it('fails closed before contacting Stripe when scope lookup fails', async () => {
    state.svc.rpc.mockResolvedValue({ error: { code: 'unavailable' } });
    expect((await portal(request())).status).toBe(503);
    expect(state.stripe.customers.retrieve).not.toHaveBeenCalled();
  });
});
