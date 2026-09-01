import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The end of the plaintext password columns.
 *
 * WHAT WAS WRONG
 *  public.developers, public.admin_users and public.clients each carry a
 *  `password` column left over from the pre-Supabase-Auth login. RLS on all
 *  three is `for all TO authenticated using (organization_id = auth_org())`
 *  (013, 014), so every logged-in member of an organization could `select *`
 *  and read every colleague's password out of it through PostgREST. Account
 *  creation kept refilling it, so cleaning old rows would never have converged.
 *
 * WHY THE LOGIN FALLBACK COULD BE DELETED WITHOUT LOCKING ANYONE OUT
 *  src/app/login/page.js used to fall back to comparing the submitted password
 *  against that column when supabase.auth.signInWithPassword() failed. A failed
 *  sign-in leaves the browser holding no JWT, so the profile SELECT immediately
 *  above the fallback ran as the `anon` PostgreSQL role — and no policy on any
 *  of the three tables grants `anon` anything. The lookup returned zero rows,
 *  the comparison was never reached, and no account could ever sign in through
 *  it. The two hand-made {public} policies on admin_users are the exception that
 *  proves it: their USING expression is `auth.uid() = id`, which is NULL for an
 *  anonymous caller and therefore never true. Migration 042 drops them.
 *
 *  Three groups of assertion below:
 *   1. Account creation writes no password column, but still provisions the
 *      real Supabase Auth credential — so nobody's sign-in changes.
 *   2. The login page consults Supabase Auth and nothing else.
 *   3. No migration in the repository grants anon or public a read on the three
 *      tables, which is the premise the deletion rests on.
 */

// ---------------------------------------------------------------------------
// Fake service-role client. No network. Records every write.
// ---------------------------------------------------------------------------

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
    ...overrides,
  };
  return state;
}

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
          const result = { data: insertedRow(table, rows), error: null };
          return thenable(result, {
            select: () => ({
              single: async () => result,
              maybeSingle: async () => result,
            }),
          });
        },
        update(patch) {
          state.updates.push({ table, patch });
          // Chainable and awaitable: signup consumes the email verification
          // with .update().eq().is().not().gte().select() as a single write
          // (migration 056). A single-level `{ eq }` throws on the second link.
          const result = {
            data: table === "email_verifications" ? [{ id: "verification-1" }] : null,
            error: null,
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
          return { eq: async () => ({ data: null, error: null }) };
        },
        select() {
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: table === "invitations" ? state.invitation : null,
                error: null,
              }),
            }),
            limit: async () => ({ data: [], error: null }),
          };
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

// Plan limits are a separate feature with its own tests; always allow here.
vi.mock("@/utils/entitlements", () => ({
  checkSeatLimitForRole: async () => null,
  checkFeatureAccess: async () => null,
}));

const { POST: signupPOST } = await import("@/app/api/auth/signup/route.js");
const { POST: acceptPOST } = await import("@/app/api/invitations/accept/route.js");

const PASSWORD = "Sup3rSecret!";

function req(body) {
  return new Request("https://verisade.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SIGNUP_BODY = {
  fullName: "Ada Lovelace",
  company: "Analytical Engines",
  email: "ada@example.com",
  password: PASSWORD,
  timezone: "UTC",
  termsAccepted: true,
};

const ACCEPT_BODY = {
  token: "tok-1",
  fullName: "Grace Hopper",
  password: PASSWORD,
  termsAccepted: true,
};

/** Every row that reached a profile table on this request. */
const profileRows = () =>
  state.inserts.filter((i) => ["admin_users", "developers", "clients"].includes(i.table));

/** Source of a file in the repo, read fresh so the assertion is about the code. */
function source(relative) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/**
 * The same source with block comments and whole-line `//` comments removed.
 *
 * Needed because the files these tests assert about explain, in comments, the
 * very thing being asserted absent — "the fallback compared against
 * profile.password" is documentation, not a fallback. Only whole-line comments
 * are stripped, so a `https://` inside code survives.
 */
function code(relative) {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

beforeEach(() => resetState());

// ---------------------------------------------------------------------------
// 1. No account-creation path writes a password into a profile table
// ---------------------------------------------------------------------------

describe("signup creates no plaintext password row", () => {
  it("writes an admin_users row with no password column at all", async () => {
    const res = await signupPOST(req(SIGNUP_BODY));
    expect(res.status).toBe(200);

    const rows = profileRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].table).toBe("admin_users");
    // `not.toHaveProperty` rather than a null check: an explicit null would
    // still be a writer to remove later, and the column may yet be dropped.
    expect(rows[0].row).not.toHaveProperty("password");
  });

  it("puts the password nowhere in the database, on any table", async () => {
    await signupPOST(req(SIGNUP_BODY));
    for (const { table, row } of state.inserts) {
      expect(JSON.stringify(row), `insert into ${table}`).not.toContain(PASSWORD);
    }
    for (const { table, patch } of state.updates) {
      expect(JSON.stringify(patch), `update of ${table}`).not.toContain(PASSWORD);
    }
  });

  it("still provisions the real Supabase Auth credential, so sign-in works", async () => {
    // The point of the whole exercise: the password stops being stored in a
    // table the organization can read, and keeps being stored — hashed — by the
    // service that actually authenticates people.
    await signupPOST(req(SIGNUP_BODY));
    expect(state.createdUsers).toHaveLength(1);
    expect(state.createdUsers[0]).toMatchObject({
      email: "ada@example.com",
      password: PASSWORD,
      email_confirm: true,
    });
    expect(state.createdUsers[0].app_metadata).toMatchObject({
      organization_id: "org-1",
      role: "owner",
      user_type: "admin",
    });
  });
});

describe("invitation acceptance creates no plaintext password row", () => {
  // One case per profile table the route can land in.
  const roles = [
    ["developer", "developers"],
    ["manager", "developers"],
    ["employee", "developers"],
    ["admin", "admin_users"],
    ["owner", "admin_users"],
    // hr USED TO BE ["hr", "admin_users"] HERE. That was the accept route's own
    // `isAdminLike` (owner/admin/hr) disagreeing with userTypeForRole(), which
    // files hr in `developers` — as /api/auth/provision and the Employees
    // screen always have. The route now calls userTypeForRole(); an invited hr
    // gets a developers row like a provisioned one. What this file is actually
    // testing — that no profile insert carries a `password` column — is
    // unaffected either way. See database/073 FINDING 3.
    ["hr", "developers"],
    ["client", "clients"],
  ];

  it.each(roles)("role %s -> %s row carries no password", async (role, table) => {
    resetState();
    state.invitation = { ...state.invitation, role };

    const res = await acceptPOST(req(ACCEPT_BODY));
    expect(res.status).toBe(200);

    const rows = profileRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].table).toBe(table);
    expect(rows[0].row).not.toHaveProperty("password");
  });

  it.each(roles)("role %s still gets a Supabase Auth account", async (role) => {
    resetState();
    state.invitation = { ...state.invitation, role };

    await acceptPOST(req(ACCEPT_BODY));

    expect(state.createdUsers).toHaveLength(1);
    expect(state.createdUsers[0]).toMatchObject({ password: PASSWORD, email_confirm: true });
    // And the profile row is linked back to it, which is what
    // /api/admin/legacy-auth-audit counts as "not legacy-only".
    expect(state.updates.some((u) => u.patch?.auth_user_id === "auth-1")).toBe(true);
  });

  it("puts the password nowhere in the database, on any table", async () => {
    await acceptPOST(req(ACCEPT_BODY));
    for (const { table, row } of state.inserts) {
      expect(JSON.stringify(row), `insert into ${table}`).not.toContain(PASSWORD);
    }
  });
});

describe("the admin 'add employee' flow", () => {
  // createStaffMember talks to Supabase from the browser; there is no DOM
  // environment here to drive it. The assertion is therefore on its source:
  // neither of the two insert payloads it builds may carry a password, and the
  // typed password must still reach /api/auth/provision, which is what creates
  // the auth account.
  //
  // This used to read AddDeveloper.jsx. That screen was folded into Employees
  // and the three writes moved to this module whole — the guarantee did not
  // change, only the file it has to hold in.
  const src = code("src/utils/staffAccounts.js");

  it("builds no insert payload containing a password field", () => {
    // Both payloads are spelled out here rather than matched loosely: they are
    // the two objects that go to `developers`, and a `password` key appearing
    // in either is the whole failure this file exists to catch.
    expect(src).not.toMatch(/const profile = \{[^}]*password/s);
    expect(src).not.toMatch(/const attributed = \{[^}]*\bpassword\b[^}]*\}/s);
    // The only place the typed password may appear is the provision request.
    const occurrences = src.match(/^\s*password,\s*$/gm) || [];
    expect(occurrences).toHaveLength(1);
  });

  it("still sends the password to /api/auth/provision", () => {
    expect(src).toContain('authFetch("/api/auth/provision"');
  });
});

describe("the client management screen", () => {
  it("creates client accounts by invitation, never by writing a row itself", () => {
    // It used to insert into `clients` directly, password and all. Client
    // accounts now come into existence only through /api/invitations/accept,
    // which is covered above.
    const src = code("src/components/admin/ClientManagement.jsx");
    expect(src).not.toMatch(/from\(["']clients["']\)\s*\.insert/);
    expect(src).toContain('authFetch("/api/invitations"');
  });
});

describe("the registration page", () => {
  const src = code("src/app/admin/registration/page.js");

  it("posts the password to the server rather than writing a profile row", () => {
    expect(src).not.toMatch(/from\(["'](admin_users|developers|clients)["']\)\s*\.insert/);
    expect(src).toContain('fetch("/api/auth/signup"');
  });

  it("no longer loads the EmailJS SDK", () => {
    // Imported and init()-ed with a public key, never once called to send.
    // A third-party SDK on the signup page is a question an auditor will ask.
    expect(src).not.toContain("@emailjs/browser");
    expect(src).not.toContain("emailjs.init");
  });

  it("keeps the terms-acceptance gate", () => {
    // Unrelated to this change and load-bearing: assert it survived.
    expect(src).toContain("TermsConsent");
    expect(src).toContain("termsAccepted");
  });
});

// ---------------------------------------------------------------------------
// 2. Login goes through Supabase Auth, and only Supabase Auth
// ---------------------------------------------------------------------------

describe("the login page", () => {
  const src = code("src/app/login/page.js");

  it("signs in with Supabase Auth", () => {
    expect(src).toContain("supabase.auth.signInWithPassword({ email, password })");
  });

  it("has no legacy password fallback left", () => {
    expect(src).not.toContain("verifyLegacyPassword");
    expect(src).not.toContain("legacyPassword");
    expect(src).not.toMatch(/profile\.password/);
  });

  it("only ever accepts a session that Supabase Auth issued", () => {
    // There must be exactly one assignment to loggedInData, and it must be
    // guarded by authData?.user. A second branch is how the fallback came back.
    const assignments = src.match(/loggedInData = /g) || [];
    expect(assignments).toHaveLength(2); // the `let ... = null` and the one success path
    expect(src).toContain("if (authData?.user && profile) {");
  });
});

// ---------------------------------------------------------------------------
// 3. The premise: anon can read none of the three tables
// ---------------------------------------------------------------------------

describe("RLS on the profile tables never grants anon a read", () => {
  const migrations = ["013_saas_rls", "014_client_portal", "018_security_hardening", "040_monitoring_access"];

  it.each(migrations)("%s creates only `to authenticated` policies", (name) => {
    const sql = source(path.join("database", `${name}.sql`));

    // Strip comments: these files discuss `anon` at length in prose.
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    // Every create-policy in these files must name a role, and that role must
    // be `authenticated`. A policy with no TO clause defaults to PUBLIC, which
    // includes anon — that is exactly the mistake 018 was written to fix.
    const policies = statements.match(/create policy[\s\S]*?(?=;|\$f\$)/gi) || [];
    for (const policy of policies) {
      const oneLine = policy.replace(/\s+/g, " ");
      // 013's group B keeps desktop tracking inserts open on purpose; it is not
      // one of the three profile tables and carries no password column.
      if (/track_insert/.test(oneLine)) continue;
      expect(oneLine, oneLine).toMatch(/\bto authenticated\b/i);
    }
  });

  it("has a migration that drops the two hand-made {public} policies", () => {
    const sql = source(path.join("database", "042_drop_dead_admin_policies.sql"));
    expect(sql).toContain('drop policy if exists "Users can view own data" on public.admin_users;');
    expect(sql).toContain('drop policy if exists "Users can update own data" on public.admin_users;');
  });
});
