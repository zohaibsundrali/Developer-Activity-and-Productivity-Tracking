import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: {}, writes: [], stripe: {}, auth: null }));
vi.mock("@/utils/serverAuth", () => ({
  getAuthedOrg: async () => state.auth,
  serviceClient: () => ({ rpc: async () => ({data: state.deleting?.length ? state.deleting.shift() : false}), from(table) {
    let updating = false;
    const q = {
      select: () => updating ? Promise.resolve({ data: state.saveRace ? [] : [{ organization_id: 'org-a' }], error: state.saveError || null }) : q,
      eq: (...args) => { state.filters.push(args); return q; },
      update: value => { updating = true; state.writes.push(value); return q; },
      maybeSingle: async () => state.queries[table] || { data: null },
      upsert: async value => { state.writes.push(value); return { error: state.saveError || null }; },
    };
    return q;
  } }),
}));
vi.mock("@/utils/serverPermissions", () => ({ requirePermission: () => null }));
vi.mock("@/utils/stripeServer", () => ({
  stripeClient: () => state.stripe, billingConfigured: () => true,
  appOrigin: () => "https://app.test",
}));
import { POST } from "@/app/api/billing/checkout/route";

const request = () => new Request("https://app.test/api/billing/checkout", {
  method: "POST", body: JSON.stringify({ planCode: "professional" }),
});
beforeEach(() => {
  state.auth = { orgId: "org-a", email: "owner@example.test" };
  state.writes = []; state.filters = []; state.saveRace = false; state.saveError = null; state.deleting = [];
  state.queries = {
    billing_plans: { data: { code: "professional", name: "Professional", is_active: true, stripe_price_id: "price_pro", amount_cents: 4900 } },
    organization_subscriptions: { data: { stripe_customer_id: "cus_a", stripe_subscription_id: "sub_a", status: "active", updated_at: "2026-01-01T00:00:00Z" } },
    organizations: { data: { name: "A" } },
  };
  state.stripe = {
    customers: { create: vi.fn().mockResolvedValue({ id: "cus_new" }) },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      retrieve: vi.fn().mockResolvedValue({ id: "sub_a", status: "active", items: { data: [{ id: "si_a", price: { id: "price_old" } }] } }),
      update: vi.fn().mockResolvedValue({ id: "sub_a", status: "active" }),
    },
    checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), expire: vi.fn().mockResolvedValue({ status: "expired" }), create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.test/session" }) } },
  };
});
describe("Checkout billing integrity", () => {
  it.each(["billing_plans", "organization_subscriptions"])("refuses failed %s lookup before contacting Stripe", async table => {
    state.queries[table] = { error: { code: "unavailable" } };
    expect((await POST(request())).status).toBe(503);
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(state.stripe.customers.create).not.toHaveBeenCalled();
  });
  it.each([new Error("timeout"), { code: "resource_missing", statusCode: 404 }])("never creates duplicate checkout after subscription verification fails", async error => {
    state.stripe.subscriptions.retrieve.mockRejectedValue(error);
    expect((await POST(request())).status).toBe(503);
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
  it("refuses payment-required changes without granting the target plan", async () => {
    state.stripe.subscriptions.update.mockRejectedValue({ type: "StripeCardError", statusCode: 402 });
    expect((await POST(request())).status).toBe(402);
    expect(state.writes).toEqual([]);
    expect(state.stripe.subscriptions.update.mock.calls[0][1].payment_behavior).toBe("error_if_incomplete");
  });
  it("reports failed synchronization after Stripe updates the subscription", async () => {
    state.saveError = { code: "unavailable" };
    expect((await POST(request())).status).toBe(503);
    expect(state.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("does not overwrite a newer webhook or plan change", async () => {
    state.saveRace = true;
    expect((await POST(request())).status).toBe(503);
    expect(state.filters).toContainEqual(["updated_at", "2026-01-01T00:00:00Z"]);
    expect(state.stripe.subscriptions.update).toHaveBeenCalledOnce();
  });
  it("uses a stable customer idempotency key and stops if customer persistence fails", async () => {
    state.queries.organization_subscriptions = { data: null };
    state.saveError = { code: "unavailable" };
    expect((await POST(request())).status).toBe(503);
    expect(state.stripe.customers.create.mock.calls[0][1]).toEqual({ idempotencyKey: "organization-customer-org-a" });
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("successfully changes a verified existing subscription", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).planChanged).toBe(true);
    expect(state.writes[0].plan_code).toBe("professional");
  });
});

describe("Checkout retries and webhook delay", () => {
  beforeEach(() => { state.queries.organization_subscriptions.data.stripe_subscription_id = null; });
  it("finds a paid subscription before its webhook saved the id", async () => {
    state.stripe.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_new", status: "active", items: { data: [{ id: "si_new", price: { id: "price_old" } }] } }] });
    expect((await POST(request())).status).toBe(200);
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(state.writes[0].stripe_subscription_id).toBe("sub_new");
  });
  it("reuses the open session for the same plan", async () => {
    state.stripe.checkout.sessions.list.mockResolvedValue({ data: [{ id: "cs_old", status: "open", metadata: { plan_code: "professional" }, url: "https://checkout.stripe.test/existing" }] });
    expect((await (await POST(request())).json()).url).toContain("existing");
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("expires a different-plan checkout before creating its replacement", async () => {
    state.stripe.checkout.sessions.list.mockResolvedValue({ data: [{ id: "cs_old", status: "open", metadata: { plan_code: "business" } }] });
    expect((await POST(request())).status).toBe(200);
    expect(state.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_old", {}, { idempotencyKey: "expire-checkout-cs_old" });
    expect(state.stripe.checkout.sessions.create.mock.calls[0][1]).toEqual({ idempotencyKey: "organization-checkout-org-a-cs_old" });
  });
  it("stops when checkout completes during the billing lookup", async () => {
    state.stripe.checkout.sessions.list.mockResolvedValue({ data: [{ id: "cs_done", status: "complete", subscription: "sub_a" }] });
    expect((await POST(request())).status).toBe(409);
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it.each(["incomplete", "paused"])("refuses a second subscription while %s", async status => {
    state.stripe.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_pending", status }] });
    expect((await POST(request())).status).toBe(409);
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("uses the same creation key for retries", async () => {
    await POST(request()); await POST(request());
    expect(state.stripe.checkout.sessions.create.mock.calls.map(call => call[1].idempotencyKey)).toEqual(["organization-checkout-org-a-first", "organization-checkout-org-a-first"]);
  });
});

describe('organization deletion billing races', () => {
  it('refuses billing before contacting a provider when deletion started', async () => {
    state.deleting = [true]; expect((await POST(request())).status).toBe(409);
    expect(state.stripe.customers.create).not.toHaveBeenCalled(); expect(state.stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it('expires a newly created checkout when deletion wins the post-provider race', async () => {
    state.queries.organization_subscriptions.data.stripe_subscription_id = null;
    state.stripe.checkout.sessions.create.mockImplementation(async () => { state.deleting=[true]; return {id:'new_session',url:'https://checkout.test'}; });
    expect((await POST(request())).status).toBe(409);
    expect(state.stripe.checkout.sessions.expire).toHaveBeenCalledWith('new_session');
  });
  it('cancels only the verified tenant subscription after a raced plan update', async () => {
    state.stripe.subscriptions.retrieve.mockResolvedValue({id:'sub_a',customer:'cus_a',metadata:{organization_id:'org-a'},status:'active',items:{data:[{id:'item',price:{id:'old'}}]}});
    state.stripe.subscriptions.update.mockImplementation(async()=>{state.deleting=[true];return {};});
    state.stripe.subscriptions.cancel=vi.fn(async()=>({status:'canceled'}));
    expect((await POST(request())).status).toBe(409);
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_a',{invoice_now:false,prorate:false});
    expect(state.writes).toHaveLength(0);
  });
});
