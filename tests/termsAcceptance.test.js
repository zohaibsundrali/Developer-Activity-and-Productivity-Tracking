import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Terms of Service acceptance.
 *
 * src/content/legal/terms.js is a complete Terms of Service and src/app/terms
 * renders it, but nothing recorded that anybody agreed to it. That is
 * browsewrap: assent inferred from the mere availability of a link, and the
 * first thing an opposing party attacks. It matters more than usual here
 * because the Terms carry the customer's obligation to lawfully notify the
 * employees this product monitors — if the Terms do not bind, that obligation
 * may not bind either.
 *
 * A disabled submit button is a suggestion. Anyone can POST to these routes
 * directly, so the assertions that actually matter are the ones proving the
 * SERVER refuses. Those are the first two describe blocks.
 */

// ---------------------------------------------------------------------------
// Fake service-role client. No network. Records every write so the tests can
// assert exactly what reached the database.
// ---------------------------------------------------------------------------

/** Result object that is both awaitable and chainable (.select().single()). */
function thenable(result, extra = {}) {
  return {
    ...extra,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
}

let state;

function resetState(overrides = {}) {
  state = {
    rpcCalls: [],
    finishError: null,
    inserts: [],
    updates: [],
    deletes: [],
    createdUsers: [],
    deletedUsers: [],
    invitation: {
      id: "invite-1",
      organization_id: "org-1",
      email: "invitee@example.com",
      role: "developer",
      status: "pending",
      token: "tok-1",
      team_id: null,
      department_id: null,
      project_id: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
    insertErrors: {},
    updateErrors: {},
    // Whether the address has a live, verified, unconsumed row in
    // `email_verifications`. Signup refuses without one (migration 056), so
    // the default here is what every pre-existing test in this file assumes:
    // a user who has just been through the code step.
    emailVerified: true,
    // The row `billing_plans` returns for a plan lookup. null means "no such
    // active plan", which is what an unknown or inactive code looks like.
    plan: null,
    ...overrides,
  };
  return state;
}

/** The row a given insert is pretended to have produced. */
function insertedRow(table, rows) {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (table === "admin_users") return { id: "admin-1", ...row };
  if (table === "organizations") return { id: "org-1", name: row.name };
  if (table === "developers") return { id: "dev-1", ...row };
  if (table === "clients") return { id: "client-1", ...row };
  return { id: `${table}-1`, ...row };
}

function fakeClient() {
  return {
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (name === "claim_invitation") return { data: { auth_user_id: "auth-1", profile_id: "dev-1" }, error: null };
      if (name === "finish_invitation") return { data: state.finishError ? null : { success: true }, error: state.finishError };
      return { data: null, error: null };
    },
    from(table) {
      return {
        insert(rows) {
          state.inserts.push({ table, row: Array.isArray(rows) ? rows[0] : rows });
          const result = {
            data: insertedRow(table, rows),
            error: state.insertErrors[table] || null,
          };
          return thenable(result, {
            select: () => ({
              single: async () => result,
              maybeSingle: async () => result,
            }),
          });
        },
        update(patch) {
          state.updates.push({ table, patch });
          // A CHAINABLE, AWAITABLE builder. `/api/auth/signup` consumes the
          // email verification with
          //   .update(...).eq(...).is(...).not(...).gte(...).select(...)
          // in ONE statement — the check and the consume are deliberately the
          // same write, so two concurrent signups on one verified code cannot
          // both pass. The old single-level `{ eq }` could not express that
          // chain and threw on the second link.
          const result = {
            data:
              table === "email_verifications"
                ? state.emailVerified
                  ? [{ id: "verification-1" }]
                  : []
                : { id: table === "admin_users" ? "admin-1" : `${table}-1`, organization_id: "org-1", ...patch },
            error: state.updateErrors?.[table] || null,
          };
          const builder = {
            eq: () => builder,
            is: () => builder,
            not: () => builder,
            gt: () => builder,
            gte: () => builder,
            lt: () => builder,
            lte: () => builder,
            select: () => thenable(result, { single: async () => result }),
          };
          return thenable(result, builder);
        },
        delete() {
          state.deletes.push({ table });
          const q = { eq: () => q, then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve) };
          return q;
        },
        select() {
          // `eq` returns a builder that carries `eq` again, so a two-filter
          // chain resolves. `resolvePlanForSignup` looks a plan up with
          // `.eq("code", …).eq("is_active", true).maybeSingle()`, which the
          // single-level version could not express — it returned an object
          // with only `maybeSingle`, so the second `.eq` threw.
          const builder = {
            eq: () => builder,
            maybeSingle: async () => ({
              data:
                table === "invitations" ? state.invitation
                : table === "projects" ? { id: "project-1" }
                : table === "billing_plans" ? state.plan
                : table === "organizations" ? { id: "org-1", name: "Analytical Engines" }
                : null,
              error: null,
            }),
            limit: async () => ({ data: [], error: null }),
          };
          return builder;
        },
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: null }, error: { status: 404 } }),
        deleteUser: async (id) => { state.deletedUsers.push(id); return { error: null }; },
        createUser: async (args) => {
          state.createdUsers.push(args);
          return { data: { user: { id: "auth-1" } }, error: null };
        },
      },
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

// Seat/plan limits are a different feature with their own tests; here they
// always pass so the terms gate is the only thing under test.
vi.mock("@/utils/entitlements", () => ({
  checkSeatLimitForRole: async () => null,
  checkFeatureAccess: async () => null,
}));

const { POST: signupPOST } = await import("@/app/api/auth/signup/route.js");
const { POST: acceptPOST } = await import("@/app/api/invitations/accept/route.js");
const { meta: termsMeta } = await import("@/content/legal/terms.js");

/** The version the routes are expected to stamp, derived the same way they do. */
const EXPECTED_VERSION = termsMeta.version || termsMeta.lastUpdated;

function req(body, headers = {}) {
  return new Request("https://verisade.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const SIGNUP_BODY = {
  fullName: "Ada Lovelace",
  company: "Analytical Engines",
  email: "ada@example.com",
  password: "Sup3rSecret!",
  timezone: "UTC",
};

const ACCEPT_BODY = {
  token: "tok-1",
  fullName: "Grace Hopper",
  password: "Sup3rSecret!",
};

const acceptanceRows = () => state.inserts.filter((i) => i.table === "terms_acceptances");

beforeEach(() => resetState());

// ---------------------------------------------------------------------------
// 1. The refusal — the load-bearing half of the feature
// ---------------------------------------------------------------------------

describe("signup refuses without acceptance", () => {
  it("400s when termsAccepted is missing entirely", async () => {
    const res = await signupPOST(req(SIGNUP_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Terms of Service/i);
  });

  it("400s when termsAccepted is explicitly false", async () => {
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: false }));
    expect(res.status).toBe(400);
  });

  it("creates NOTHING when it refuses — no admin, org, membership or auth user", async () => {
    await signupPOST(req(SIGNUP_BODY));
    expect(state.inserts).toEqual([]);
    expect(state.createdUsers).toEqual([]);
  });

  // Only a real boolean counts. Every value below is truthy in JavaScript and
  // none of them is a person ticking a box; a truthiness check would let a
  // hand-rolled POST through with `termsAccepted: "no"`.
  it.each([["string yes", "yes"], ["string false", "false"], ["number 1", 1], ["object", {}], ["array", []]])(
    "refuses the truthy non-boolean %s",
    async (_label, value) => {
      const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: value }));
      expect(res.status).toBe(400);
      expect(acceptanceRows()).toEqual([]);
    }
  );

  it("still refuses missing email before anything else, unchanged", async () => {
    const res = await signupPOST(req({ password: "x", termsAccepted: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid email/);
  });
});

describe("invitation accept refuses without acceptance", () => {
  it("400s when termsAccepted is missing entirely", async () => {
    const res = await acceptPOST(req(ACCEPT_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Terms of Service/i);
  });

  it("400s when termsAccepted is explicitly false", async () => {
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: false }));
    expect(res.status).toBe(400);
  });

  it("refuses before the invitation is consumed — no rows, invite still pending", async () => {
    await acceptPOST(req(ACCEPT_BODY));
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.createdUsers).toEqual([]);
  });

  it.each([["string yes", "yes"], ["number 1", 1], ["object", {}]])(
    "refuses the truthy non-boolean %s",
    async (_label, value) => {
      const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: value }));
      expect(res.status).toBe(400);
      expect(state.inserts).toEqual([]);
    }
  );

  it("still refuses a missing token before anything else, unchanged", async () => {
    const res = await acceptPOST(req({ password: "x", termsAccepted: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invitation token");
  });
});

// ---------------------------------------------------------------------------
// 2. What gets recorded when acceptance IS present
// ---------------------------------------------------------------------------

// Signup consent/plan persistence is exercised against PostgreSQL in
// database/tests/transactional_signup_recovery.sql and the route in signupIdentityLinking.test.js.

describe("invitation acceptance transaction contract", () => {
  it("passes the server Terms version and validated IP to the atomic operation", async () => {
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true, termsVersion: "forged" }, { "x-real-ip": "198.51.100.7" }));
    expect(res.status).toBe(200);
    const finish = state.rpcCalls.filter(c => c.name === "finish_invitation");
    expect(finish).toHaveLength(1);
    expect(finish[0].args).toMatchObject({ p_id: "invite-1", p_terms_version: EXPECTED_VERSION, p_ip: "198.51.100.7" });
    expect(state.inserts).toHaveLength(0); // Application writes belong to the tested SQL transaction.
  });
  it("does not report success when the Terms transaction fails", async () => {
    state.finishError = { message: "Terms insert failed" };
    expect((await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }))).status).toBe(503);
    expect(state.deletedUsers).toEqual([]); // A lost commit response must never destroy an accepted account.
  });
  it.each(["junk", "999.2.3.4"])("rejects malformed IP %s before the inet argument", async ip => {
    await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }, { "x-real-ip": ip }));
    expect(state.rpcCalls.find(c => c.name === "finish_invitation").args.p_ip).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Existing behaviour is untouched
// ---------------------------------------------------------------------------

describe("invitation state regressions", () => {
  it("accept still rejects an already-used invitation with 409", async () => {
    state.invitation.status = "accepted";
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(res.status).toBe(409);
    expect(acceptanceRows()).toEqual([]);
  });

  it("accept still rejects a revoked invitation with 410", async () => {
    state.invitation.status = "revoked";
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(res.status).toBe(410);
  });

  it("accept still rejects an expired invitation with 410", async () => {
    state.invitation.expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(res.status).toBe(410);
    expect(acceptanceRows()).toEqual([]);
  });

  it("accept still marks the invitation accepted on success", async () => {
    await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(state.rpcCalls.filter(c => c.name === "finish_invitation")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. The checkbox defaults to unchecked
//
// vitest runs in the `node` environment here (vitest.config.mjs) with no DOM
// and no React testing library, so these assert on the source of the two pages
// rather than on a render. That is a weaker test than mounting the component,
// but it does pin the one property that has to hold: a pre-ticked box is not
// valid consent in the EU, so the state must start false and the input must
// never carry `defaultChecked` or a hardcoded `checked`.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");

/**
 * Block comments are stripped before asserting. Both pages document in prose
 * that they must never use `defaultChecked` — a comment saying "do not do X"
 * must not read as doing X.
 */
const code = (relative) =>
  readFileSync(path.join(ROOT, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const REGISTRATION = code("src/app/admin/registration/page.js");
const INVITE = code("src/app/invite/[token]/page.jsx");
const PAGES = [
  ["registration page", REGISTRATION],
  ["invite page", INVITE],
];

describe("the consent checkbox defaults to unchecked", () => {
  it.each(PAGES)("%s initialises its terms state to false", (_label, src) => {
    const declarations = src.match(/const \[\w*[Tt]ermsAccepted, set\w+\] = useState\(([^)]*)\)/g) || [];
    expect(declarations.length).toBeGreaterThan(0);
    for (const decl of declarations) {
      expect(decl).toMatch(/useState\(false\)$/);
    }
  });

  it("registration declares both paths unchecked (create and join)", () => {
    expect(REGISTRATION).toContain("const [termsAccepted, setTermsAccepted] = useState(false)");
    expect(REGISTRATION).toContain("const [joinTermsAccepted, setJoinTermsAccepted] = useState(false)");
  });

  it.each(PAGES)("%s never pre-ticks the box", (_label, src) => {
    expect(src).not.toMatch(/defaultChecked/);
    expect(src).not.toMatch(/checked=\{true\}/);
    // A bare `checked` attribute with no value is `true` in JSX.
    expect(src).not.toMatch(/<input[^>]*\schecked\s*[/>]/);
  });

  it.each(PAGES)("%s binds the checkbox to state, so only the user can set it", (_label, src) => {
    expect(src).toMatch(/type="checkbox"/);
    expect(src).toMatch(/checked=\{checked\}/);
    expect(src).toMatch(/onChange=\{\(e\) => onChange\(e\.target\.checked\)\}/);
  });

  it.each(PAGES)("%s sends the flag to the server", (_label, src) => {
    expect(src).toMatch(/termsAccepted/);
  });

  it("registration sends each form's own flag, never the other's", () => {
    expect(REGISTRATION).toContain("termsAccepted: joinTermsAccepted");
    expect(REGISTRATION).toMatch(/timezone:[\s\S]{0,200}?termsAccepted,/);
  });

  it.each(PAGES)("%s links to the Terms so the user can actually read them", (_label, src) => {
    expect(src).toMatch(/href="\/terms"/);
  });
});

/**
 * Which plan a signup is allowed to start on.
 *
 * The browser sends a plan code; the server decides what it means. Every test
 * here is about the server ignoring what it was told when what it was told
 * would hand out something valuable.
 */
// Signup consent/plan persistence is exercised against PostgreSQL in
// database/tests/transactional_signup_recovery.sql and the route in signupIdentityLinking.test.js.

describe("invitation write failures", () => {
  it.each(["PLAN_LIMIT_REACHED: employees", "BILLING_LOCKED"])("returns 402 for %s without deleting a reserved Auth account", async message => {
    state.finishError = { message };
    expect((await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }))).status).toBe(402);
    expect(state.deletedUsers).toEqual([]);
    expect(state.rpcCalls.at(-1).name).toBe("release_invitation_claim");
  });
  it.each(["expired", "unknown"])("rejects status %s before reserving identities", async status => {
    state.invitation.status = status;
    expect((await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }))).status).toBe(410);
    expect(state.rpcCalls).toEqual([]);
  });
});
