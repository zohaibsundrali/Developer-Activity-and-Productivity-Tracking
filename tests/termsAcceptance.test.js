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
    inserts: [],
    updates: [],
    deletes: [],
    createdUsers: [],
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
                : null,
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
            select: () => thenable(result),
          };
          return thenable(result, builder);
        },
        delete() {
          state.deletes.push({ table });
          return { eq: async () => ({ data: null, error: null }) };
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
                : table === "billing_plans" ? state.plan
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
    expect((await res.json()).error).toBe("email and password are required");
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
    expect((await res.json()).error).toBe("token and password are required");
  });
});

// ---------------------------------------------------------------------------
// 2. What gets recorded when acceptance IS present
// ---------------------------------------------------------------------------

describe("signup records the acceptance", () => {
  it("succeeds and writes exactly one terms_acceptances row", async () => {
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(acceptanceRows()).toHaveLength(1);
  });

  it("stores the document VERSION, not merely a boolean", async () => {
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    const row = acceptanceRows()[0].row;
    expect(row.document_version).toBe(EXPECTED_VERSION);
    expect(row.document_version).toBeTruthy();
    expect(row.document).toBe("terms_of_service");
    // The whole point: a boolean could not answer "who accepted the version
    // that contained clause 3.5". Nothing here is a bare true/false flag.
    expect(row.terms_accepted).toBeUndefined();
  });

  it("takes the version from the Terms module, never from the request", async () => {
    await signupPOST(
      req({ ...SIGNUP_BODY, termsAccepted: true, termsVersion: "1900-01-01", document_version: "spoofed" })
    );
    expect(acceptanceRows()[0].row.document_version).toBe(EXPECTED_VERSION);
  });

  it("records who and when", async () => {
    const before = Date.now();
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    const row = acceptanceRows()[0].row;
    expect(row.organization_id).toBe("org-1");
    expect(row.user_id).toBe("admin-1");
    expect(row.user_type).toBe("admin");
    expect(row.email).toBe("ada@example.com");
    const at = Date.parse(row.accepted_at);
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("marks the entry point as signup", async () => {
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(acceptanceRows()[0].row.entry_point).toBe("signup");
  });

  it("captures the IP when the request already carries one", async () => {
    await signupPOST(
      req({ ...SIGNUP_BODY, termsAccepted: true }, { "x-forwarded-for": "203.0.113.9, 70.41.3.18" })
    );
    expect(acceptanceRows()[0].row.ip).toBe("203.0.113.9");
  });

  it("stores null rather than junk when the IP is absent or malformed", async () => {
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(acceptanceRows()[0].row.ip).toBeNull();

    resetState();
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }, { "x-forwarded-for": "not-an-ip" }));
    expect(acceptanceRows()[0].row.ip).toBeNull();

    resetState();
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }, { "x-forwarded-for": "999.1.1.1" }));
    expect(acceptanceRows()[0].row.ip).toBeNull();
  });

  it("stores nothing beyond what it needs — no user agent, headers or body", async () => {
    await signupPOST(
      req({ ...SIGNUP_BODY, termsAccepted: true }, { "user-agent": "Mozilla/5.0 (spy)" })
    );
    expect(Object.keys(acceptanceRows()[0].row).sort()).toEqual([
      "accepted_at",
      "document",
      "document_version",
      "email",
      "entry_point",
      "ip",
      "organization_id",
      "user_id",
      "user_type",
    ]);
  });

  it("does not fail the signup if the acceptance insert errors", async () => {
    // The account already exists by this point; a "registration failed"
    // message for an account that does exist is worse than a logged failure.
    resetState({ insertErrors: { terms_acceptances: { message: "boom" } } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("invitation accept records the acceptance", () => {
  it("succeeds and writes exactly one terms_acceptances row", async () => {
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(acceptanceRows()).toHaveLength(1);
  });

  it("stores the version, the subject and the timestamp", async () => {
    const before = Date.now();
    await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    const row = acceptanceRows()[0].row;
    expect(row.document_version).toBe(EXPECTED_VERSION);
    expect(row.organization_id).toBe("org-1");
    expect(row.user_id).toBe("dev-1");
    expect(row.user_type).toBe("developer");
    expect(row.email).toBe("invitee@example.com");
    expect(Date.parse(row.accepted_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("marks the entry point as invitation, distinguishing it from signup", async () => {
    await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(acceptanceRows()[0].row.entry_point).toBe("invitation");
  });

  it.each([
    ["developer", "developer", "dev-1"],
    ["manager", "developer", "dev-1"],
    ["employee", "developer", "dev-1"],
    ["owner", "admin", "admin-1"],
    ["admin", "admin", "admin-1"],
    // hr USED TO BE ["hr", "admin", "admin-1"] HERE, AND THAT ROW ENCODED A BUG.
    // The accept route computed its own `isAdminLike` (owner/admin/hr) instead
    // of calling userTypeForRole(), which has always answered "developer" for
    // hr — so the same role got user_type "developer" when provisioned and
    // "admin" when invited, and "admin" is the answer that opens the
    // userType-keyed branches in /api/productivity, /api/keyboard-stats and
    // /api/task-submission. The route now calls userTypeForRole(); this row
    // follows it. See database/073 FINDING 3 and tests/roleIdentityAndRls.test.js.
    ["hr", "developer", "dev-1"],
    ["client", "client", "client-1"],
  ])("records the correct user_type for an invited %s", async (role, userType, userId) => {
    resetState();
    state.invitation.role = role;
    await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    const row = acceptanceRows()[0].row;
    expect(row.user_type).toBe(userType);
    expect(row.user_id).toBe(userId);
    // The user_type vocabulary must stay inside the CHECK constraint in
    // database/039_terms_acceptance.sql PART 2.
    expect(["admin", "developer", "client"]).toContain(row.user_type);
  });

  it("captures the IP when present", async () => {
    await acceptPOST(
      req({ ...ACCEPT_BODY, termsAccepted: true }, { "x-real-ip": "198.51.100.7" })
    );
    expect(acceptanceRows()[0].row.ip).toBe("198.51.100.7");
  });

  it("does not fail the acceptance if the insert errors", async () => {
    resetState({ insertErrors: { terms_acceptances: { message: "boom" } } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await acceptPOST(req({ ...ACCEPT_BODY, termsAccepted: true }));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. Existing behaviour is untouched
// ---------------------------------------------------------------------------

describe("nothing else about signup or accept changed", () => {
  it("signup still creates admin, organization, membership and auth user in order", async () => {
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    // `organization_subscriptions` sits between the membership and the terms
    // record: every organization gets exactly one subscription row from the
    // moment it exists, so the shape of the data does not depend on when the
    // account was created. The acceptance is still written, and still last.
    expect(state.inserts.map((i) => i.table)).toEqual([
      "admin_users",
      "organizations",
      "memberships",
      "organization_subscriptions",
      "terms_acceptances",
    ]);
    expect(state.createdUsers).toHaveLength(1);
    expect(state.createdUsers[0].app_metadata.role).toBe("owner");
  });

  it("signup still rolls back the admin row when the organization fails", async () => {
    resetState({ insertErrors: { organizations: { message: "nope" } } });
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(res.status).toBe(500);
    expect(state.deletes.map((d) => d.table)).toEqual(["admin_users"]);
    expect(acceptanceRows()).toEqual([]);
  });

  it("signup still 409s on a duplicate email", async () => {
    resetState({ insertErrors: { admin_users: { code: "23505", message: "dupe" } } });
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(res.status).toBe(409);
    expect(acceptanceRows()).toEqual([]);
  });

  // ── The email-verification gate (migration 056) ──────────────────────
  //
  // Until this existed, the verification code was generated by the browser,
  // held in React state and compared by the browser — so this route created
  // organizations for addresses nobody had ever proven they could read. A
  // direct POST skipped the step entirely, which is exactly what these tests
  // do: they never touch the registration page.

  it("REFUSES a signup for an address with no verified code", async () => {
    resetState({ emailVerified: false });
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("email_not_verified");
  });

  it("creates nothing at all when the address is unverified", async () => {
    // The gate runs BEFORE any write, so a refused signup must leave no
    // admin_users row, no organization, no membership and no auth account —
    // the same property the Terms gate above has.
    resetState({ emailVerified: false });
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(state.inserts).toEqual([]);
    expect(state.createdUsers).toEqual([]);
  });

  it("consumes the verification, so one code cannot create two organizations", async () => {
    resetState();
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    const consume = state.updates.find((u) => u.table === "email_verifications");
    expect(consume).toBeTruthy();
    expect(consume.patch.consumed_at).toBeTruthy();
  });

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
    expect(state.updates.some((u) => u.table === "invitations" && u.patch.status === "accepted")).toBe(true);
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
describe("the plan a signup starts on", () => {
  const subRow = () => state.inserts.find((i) => i.table === "organization_subscriptions")?.row;

  it("starts on free when no plan is asked for", async () => {
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true }));
    expect(subRow()).toMatchObject({ plan_code: "free", status: "active" });
    expect(subRow().trial_end).toBeUndefined();
  });

  it("starts a 7-day trial on a paid plan that has one", async () => {
    resetState({ plan: { code: "business", name: "Business", trial_days: 7, is_active: true } });
    const before = Date.now();
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true, planCode: "business" }));

    const row = subRow();
    expect(row).toMatchObject({ plan_code: "business", status: "trialing" });
    const days = (new Date(row.trial_end) - before) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("REFUSES a paid plan that has no self-serve trial, and falls back to free", async () => {
    // database/053 seeds enterprise with trial_days = 0, meaning "sold, not
    // signed up for". `trialEndFor` treats 0 as a nonsensical value and falls
    // back to its 7-day default, so without an explicit check this granted a
    // free 7-day trial of the unlimited plan — every limit -1, every feature
    // on, no payment of any kind — to anyone who clicked the Enterprise card.
    resetState({ plan: { code: "enterprise", name: "Enterprise", trial_days: 0, is_active: true } });
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true, planCode: "enterprise" }));

    expect(subRow()).toMatchObject({ plan_code: "free", status: "active" });
    const body = await res.json();
    expect(body.plan.code).toBe("free");
  });

  it("falls back to free for a plan code that does not exist", async () => {
    resetState({ plan: null });
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true, planCode: "made-up-plan" }));
    expect(subRow()).toMatchObject({ plan_code: "free", status: "active" });
  });

  it("records the card step only when it actually happened", async () => {
    resetState({ plan: { code: "business", name: "Business", trial_days: 7, is_active: true } });
    await signupPOST(
      req({ ...SIGNUP_BODY, termsAccepted: true, planCode: "business", paymentMethodProvided: true })
    );
    expect(subRow().last_payment_status).toBe("demo_card_on_file");

    resetState({ plan: { code: "business", name: "Business", trial_days: 7, is_active: true } });
    await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true, planCode: "business" }));
    expect(subRow().last_payment_status).toBeNull();
  });

  it("never reports a trial it failed to create", async () => {
    // The response used to be built from the row it MEANT to insert, so a
    // failed insert still told the user "you're on a Business trial until the
    // 17th" — and then handed them free limits on day one.
    resetState({
      plan: { code: "business", name: "Business", trial_days: 7, is_active: true },
      insertErrors: { organization_subscriptions: { message: "nope" } },
    });
    const res = await signupPOST(req({ ...SIGNUP_BODY, termsAccepted: true, planCode: "business" }));
    const body = await res.json();

    expect(body.success).toBe(true); // the account still exists
    expect(body.plan).toEqual({ code: "free", status: "active", trialEndsAt: null });
  });

  it("carries no card data into the subscription row", async () => {
    resetState({ plan: { code: "business", name: "Business", trial_days: 7, is_active: true } });
    await signupPOST(
      req({
        ...SIGNUP_BODY,
        termsAccepted: true,
        planCode: "business",
        paymentMethodProvided: true,
        // Even if a caller sends these by hand, nothing may read them.
        cardNumber: "4242424242424242",
        cvc: "123",
      })
    );
    const serialized = JSON.stringify(state.inserts);
    expect(serialized).not.toContain("4242");
    expect(serialized).not.toContain("123");
  });
});
