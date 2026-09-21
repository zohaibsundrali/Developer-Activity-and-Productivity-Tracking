import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({}));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => ({orgId:'org-a',userId:'payer'}), serviceClient: () => ({
  rpc: async (name) => name === 'billing_scope' ? {data:{accountId:'org-a',ownerAuthId:'payer',organizationIds:['org-a']}} : state.deletion.shift() || {data:false},
  from: () => {
    let writing = false;
    const query = { select: () => writing ? Promise.resolve(state.save) : query, eq: (...args) => {state.filters.push(args); return query;},
      maybeSingle: async () => state.lookup, update: patch => {writing=true;state.patch=patch;return query;} };
    return query;
  },
}) }));
vi.mock('@/utils/serverPermissions', () => ({requirePermission: () => null}));
vi.mock('@/utils/stripeServer', async importOriginal => ({...await importOriginal(), stripeClient: () => state.stripe, billingConfigured: () => true, appOrigin: () => 'https://app.test'}));
import {POST as cancel} from '@/app/api/billing/cancel/route';
import {POST as portal} from '@/app/api/billing/portal/route';
const request = (body={}) => new Request('https://app.test/api/billing', {method:'POST', body:JSON.stringify(body)});
beforeEach(() => {
  state.lookup={data:{stripe_subscription_id:'sub-a',stripe_customer_id:'cus-a',updated_at:'2026-01-01T00:00:00Z'}};
  state.save={data:[{organization_id:'org-a'}]}; state.filters=[]; state.patch=null;state.deletion=[];
  state.stripe={subscriptions:{retrieve:vi.fn(async()=>({customer:'cus-a',metadata:{organization_id:'org-a'}})),update:vi.fn(async()=>({cancel_at_period_end:true,canceled_at:1718452800}))},
    customers:{retrieve:vi.fn(async()=>({metadata:{organization_id:'org-a'}}))},billingPortal:{sessions:{create:vi.fn(async()=>({url:'https://billing.stripe.test/session'}))}}};
});
describe('billing management failure recovery',()=>{
  it.each([cancel,portal])('reports database read outage without provider writes',async route=>{
    state.lookup={error:{code:'unavailable'}};
    expect((await route(request())).status).toBe(503);
    expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();expect(state.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
  it.each([cancel,portal])('blocks a deleting organization',async route=>{
    state.deletion=[{data:true}];expect((await route(request())).status).toBe(409);
    expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();expect(state.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
  it.each([cancel,portal])('fails closed when deletion state is unavailable',async route=>{
    state.deletion=[{error:{code:'unavailable'}}];expect((await route(request())).status).toBe(503);
  });
  it.each([null,[],{resume:'true'}])('rejects malformed cancellation input',async body=>{
    expect((await cancel(request(body))).status).toBe(400);expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it('rejects a subscription linked to another customer',async()=>{
    state.stripe.subscriptions.retrieve.mockResolvedValue({customer:'cus-other',metadata:{organization_id:'org-a'}});
    expect((await cancel(request())).status).toBe(409);expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it('rejects a foreign customer before exposing a portal URL',async()=>{
    state.stripe.customers.retrieve.mockResolvedValue({metadata:{organization_id:'other'}});
    expect((await portal(request())).status).toBe(409);expect(state.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
  it.each([{error:{code:'unavailable'}},{data:[]}])('reports pending synchronization after failed or raced save',async save=>{
    state.save=save;expect((await cancel(request())).status).toBe(503);expect(state.stripe.subscriptions.update).toHaveBeenCalledOnce();
  });
  it('stores provider values conditionally against the original row revision',async()=>{
    expect((await cancel(request())).status).toBe(200);
    expect(state.patch.canceled_at).toBe('2024-06-15T12:00:00.000Z');
    expect(state.filters).toContainEqual(['updated_at','2026-01-01T00:00:00Z']);
    expect(state.filters).toContainEqual(['stripe_subscription_id','sub-a']);
  });
  it.each([cancel,portal])('withholds success if deletion starts during the provider request',async route=>{
    state.deletion=[{data:false},{data:true}];expect((await route(request())).status).toBe(409);expect(state.patch).toBeNull();
  });
});
