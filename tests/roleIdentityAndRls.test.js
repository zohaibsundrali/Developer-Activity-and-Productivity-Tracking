import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { defaultRolesFor } from "@/utils/permissionCatalogue";
import { ROLES, STAFF_ROLES, userTypeForRole, PROFILE_TABLE, isRole } from "@/utils/roles";

/**
 * Three confirmed findings, one per `describe`.
 *
 *   H-1  `task.set_client_visibility` had ZERO server-side enforcement. The
 *        catalogue key was consulted by one line of JSX to decide whether to
 *        DRAW a checkbox; the write went from the browser to PostgREST with the
 *        anon key, and 057's org_isolation policy on developer_tasks has no
 *        role term at all. Any non-client member of the org could publish any
 *        task — and with it the task's comments, via 033 — to the client
 *        portal. Closed by a BEFORE UPDATE trigger in database/073.
 *
 *   H-2  RLS granted `hr` the whole monitoring surface (keystrokes, activity
 *        logs, time logs, screenshots, the monitoring bucket) through
 *        auth_monitoring_sees_all(), which the catalogue's `monitoring.view`
 *        and sectionAccess.js lines 65-75 both deny. Closed by replacing the
 *        function in database/073 PART 4.
 *
 *   H-3  Two contradictory `user_type` values for `hr`: "developer" from
 *        userTypeForRole(), "admin" from the invitations/accept route's own
 *        `isAdminLike`. The "admin" answer opened the userType-keyed branches
 *        in /api/productivity, /api/keyboard-stats and /api/task-submission.
 *        Closed by making the accept route call userTypeForRole().
 *
 * TWO TRAPS THIS SUITE IS WRITTEN AGAINST, both of which this codebase has hit:
 *
 *   (a) ASSERTING AGAINST A COMMENT. 073's header WARNS about `security
 *       definer` and DISCUSSES hr at length, so `expect(sql).not.toContain(...)`
 *       over the raw file would pass or fail for reasons that have nothing to
 *       do with the code. Every SQL assertion below runs on `stripSql()` output,
 *       and `strips its own header` proves the stripper actually works.
 *
 *   (b) AN ASSERTION THE BROKEN VERSION ALSO SATISFIES. `toContain("owner")`
 *       is true of every widened role list ever written. So the role lists are
 *       PARSED out of the SQL and compared for EXACT SET EQUALITY against the
 *       permission catalogue — the widening is the failure, not just the
 *       removal.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** SQL with `--` line comments removed. See trap (a). */
const stripSql = (s) => s.replace(/^\s*--.*$/gm, "");

/** JS/JSX with `//` and block comments removed. */
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "database/073_client_visibility_and_monitoring.sql";
const ACCEPT = "src/app/api/invitations/accept/route.js";

const SQL_RAW = read(MIGRATION);
const SQL = stripSql(SQL_RAW);

/**
 * Pull the quoted role names out of an `in (...)` list, given the text that
 * introduces it. Returns a sorted array so the comparison is set equality.
 *
 * Doubled single quotes are how 040 and PART 4 write string literals inside a
 * single-quoted function body, so both `'owner'` and `''owner''` must parse.
 */
function rolesInListAfter(sql, anchor) {
  const at = sql.indexOf(anchor);
  expect(at, `anchor not found in SQL: ${anchor}`).toBeGreaterThan(-1);
  const open = sql.indexOf("(", at + anchor.length);
  const close = sql.indexOf(")", open);
  expect(open, anchor).toBeGreaterThan(-1);
  expect(close, anchor).toBeGreaterThan(open);
  const inner = sql.slice(open + 1, close);
  const found = inner.match(/'{1,2}([a-z_]+)'{1,2}/g) || [];
  return found.map((t) => t.replace(/'/g, "")).sort();
}

describe("the stripper itself", () => {
  /**
   * Trap (a), made impossible rather than merely avoided. 073's header says
   * `security definer` (warning against it) and says `hr` (explaining its
   * removal) many times. If stripSql ever stopped working, every assertion
   * below would silently start reading prose.
   */
  it("removes the header, which does mention both dangerous strings", () => {
    expect(SQL_RAW).toContain("security definer");
    expect(SQL_RAW.toLowerCase()).toContain("hr");
    expect(SQL).not.toContain("security definer");
  });

  it("keeps the statements", () => {
    expect(SQL).toContain("create or replace function public.auth_monitoring_sees_all()");
    expect(SQL).toContain("create trigger trg_developer_tasks_client_visibility_guard");
  });

  it("does not eat a `--` that is inside a string literal, because there is none", () => {
    // Guards the stripper's own blind spot: it is line-based, so a `--` inside
    // a quoted body would take the rest of that line with it. Assert the shape
    // it relies on rather than trusting it.
    expect(SQL_RAW).not.toMatch(/'[^'\n]*--/);
  });
});

describe("H-1 · client_visible cannot be flipped by anyone who feels like it", () => {
  it("installs a BEFORE UPDATE row trigger on developer_tasks", () => {
    expect(SQL).toMatch(
      /create trigger trg_developer_tasks_client_visibility_guard\s+before update on public\.developer_tasks\s+for each row execute function public\.developer_tasks_guard_client_visibility\(\)/
    );
  });

  it("is re-runnable: the trigger is dropped by name first", () => {
    const drop = SQL.indexOf("drop trigger if exists trg_developer_tasks_client_visibility_guard");
    const create = SQL.indexOf("create trigger trg_developer_tasks_client_visibility_guard");
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it("declares the function before the trigger that names it", () => {
    expect(SQL.indexOf("create or replace function public.developer_tasks_guard_client_visibility"))
      .toBeLessThan(SQL.indexOf("create trigger trg_developer_tasks_client_visibility_guard"));
  });

  it("is SECURITY INVOKER — the 048 trap", () => {
    /**
     * A security definer function reports current_user as its OWNER, which on
     * Supabase is postgres, so the privileged-role escape would pass EVERY
     * caller while the file still looked applied. The `not.toContain` here is
     * meaningful ONLY because it runs on stripped SQL — the header warns about
     * exactly this string.
     */
    expect(SQL).toContain("security invoker");
    expect(SQL).not.toContain("security definer");
  });

  it("guards the client_visible column and compares OLD to NEW through to_jsonb", () => {
    expect(SQL).toContain("(to_jsonb(old) ->> 'client_visible')");
    expect(SQL).toContain("(to_jsonb(new) ->> 'client_visible')");
    // `is distinct from`, not `<>`: `<>` returns null for null -> true, and
    // null is not true, so the guard would let the first write through.
    expect(SQL).toMatch(/is not distinct from \(to_jsonb\(new\) ->> 'client_visible'\)/);
    expect(SQL).not.toMatch(/to_jsonb\(old\) ->> 'client_visible'\)\s*<>/);
  });

  it("exempts the service role, or every server-side task write becomes a 403", () => {
    // RLS is bypassed for the service role. TRIGGERS ARE NOT.
    expect(SQL).toContain("current_user in ('service_role','postgres','supabase_admin'");
    expect(SQL).toContain("rolsuper or r.rolbypassrls");
    // And it must test the DATABASE role, not a forgeable JWT claim.
    expect(SQL).toContain("from pg_roles r where r.rolname = current_user");
  });

  it("refuses with 42501, so PostgREST answers 403 rather than 500", () => {
    expect(SQL).toContain("errcode = '42501'");
  });

  it("entitles EXACTLY the roles the catalogue gives task.set_client_visibility", () => {
    /**
     * TRAP (b). `toContain('owner')` is satisfied by every widened list that
     * has ever been written, including one that adds team_lead, hr or
     * developer. Set equality against the catalogue is not.
     */
    const catalogue = [...defaultRolesFor("task.set_client_visibility")].sort();
    expect(catalogue).toEqual(["admin", "manager", "owner"]);

    const inTrigger = rolesInListAfter(SQL, "coalesce(v_role in ");
    expect(inTrigger).toEqual(catalogue);
  });

  it("does not entitle the roles the drawer's comment names as the reason", () => {
    // Belt and braces on the set-equality test above, and it names the roles a
    // widening would most plausibly add.
    const inTrigger = rolesInListAfter(SQL, "coalesce(v_role in ");
    for (const role of ["team_lead", "hr", "qa", "developer", "designer", "devops", "finance", "employee", "client"]) {
      expect(inTrigger, role).not.toContain(role);
    }
  });

  it("keeps the client lock as a second bolt, not a dependency on 057", () => {
    expect(SQL).toContain("and not public.auth_is_client()");
  });

  it("still has no API route in front of the write — which is why it is in SQL", () => {
    /**
     * The finding, restated as an assertion: the ONLY places in src/ that name
     * the catalogue key are the catalogue and the drawer. If someone later adds
     * a route, this test should be revisited — but the trigger stays either
     * way, because the browser talks to PostgREST directly.
     */
    const drawer = read("src/components/admin/TaskDetailDrawer.jsx");
    expect(drawer).toContain('allowed("task.set_client_visibility")');
    expect(stripJs(read("src/utils/pmData.js"))).toMatch(
      /from\("developer_tasks"\)\s*\.update\(/
    );
  });

  it("touches no policy and deletes no data — it must be reviewable and safe", () => {
    expect(SQL).not.toMatch(/^\s*drop policy/im);
    expect(SQL).not.toMatch(/^\s*drop function/im);
    expect(SQL).not.toMatch(/^\s*delete from/im);
    expect(SQL).not.toMatch(/^\s*update public\./im);
    expect(SQL).not.toMatch(/^\s*alter table/im);
  });
});

describe("H-2 · hr is off the monitoring surface", () => {
  const CATALOGUE = [...defaultRolesFor("monitoring.view")].sort();

  it("the catalogue itself still says owner + admin", () => {
    // If this changes, the SQL must change WITH it, and the next test enforces
    // that. Pinned so a catalogue edit cannot make the parity test vacuous by
    // widening both sides at once without anyone noticing.
    expect(CATALOGUE).toEqual(["admin", "owner"]);
  });

  it("073 redefines auth_monitoring_sees_all with exactly the catalogue's roles", () => {
    const inSql = rolesInListAfter(SQL, "public.auth_role() in ");
    expect(inSql).toEqual(CATALOGUE);
    expect(inSql).not.toContain("hr");
  });

  it("the LAST definition anywhere in database/ is the narrow one", () => {
    /**
     * 040 line 205 still contains the wide version, and `create or replace`
     * means whichever file runs last wins. Applying database/ in file-number
     * order must therefore end on the narrow definition. This is the assertion
     * that would fail if a future migration re-added hr, or if 073 were
     * renumbered BELOW 040.
     */
    const files = readdirSync(path.join(root, "database"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const definers = files.filter((f) =>
      stripSql(read(`database/${f}`)).includes(
        "create or replace function public.auth_monitoring_sees_all()"
      )
    );
    expect(definers).toContain("040_monitoring_access.sql");
    expect(definers).toContain("073_client_visibility_and_monitoring.sql");

    const last = definers[definers.length - 1];
    expect(last).toBe("073_client_visibility_and_monitoring.sql");
    expect(rolesInListAfter(stripSql(read(`database/${last}`)), "public.auth_role() in ")).toEqual(
      CATALOGUE
    );
  });

  it("keeps the signature identical, so the dependent policies survive", () => {
    // A dozen policies across 040/044/045/046/047 call this by name. `create or
    // replace` rewrites the body under all of them; a `drop ... cascade` would
    // take every monitoring read policy with it.
    expect(SQL).toContain(
      "create or replace function public.auth_monitoring_sees_all() returns boolean language sql stable as"
    );
    expect(SQL).not.toMatch(/drop function[^\n]*auth_monitoring_sees_all/i);
  });

  it("keeps the client lock and the null-role coalesce", () => {
    const line = SQL.split("\n").find((l) =>
      l.includes("create or replace function public.auth_monitoring_sees_all()")
    );
    expect(line).toContain("coalesce(");
    expect(line).toContain("not public.auth_is_client()");
  });

  it("agrees with the section table, which is what the UI already believed", () => {
    // sectionAccess.js maps both monitoring screens to `monitoring.view`, so
    // the SQL role list and the sidebar are now the same list.
    const access = read("src/components/shell/sectionAccess.js");
    expect(access).toContain('"developer-activity": "monitoring.view"');
    expect(access).toContain('productivity: "monitoring.view"');
    expect(rolesInListAfter(SQL, "public.auth_role() in ")).toEqual(CATALOGUE);
  });
});

/* ------------------------------------------------------------------ */
/*  H-3 — behavioural. The route is executed against a recording fake. */
/* ------------------------------------------------------------------ */

let db = null;

vi.mock("@/utils/entitlements", () => ({
  checkSeatLimitForRole: vi.fn(async () => null),
  checkFeatureAccess: vi.fn(async () => null),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table) => db.from(table),
    auth: { admin: { createUser: (payload) => db.createUser(payload) } },
  }),
}));

/**
 * A minimal PostgREST-shaped recorder. Every call the route makes is written
 * down so the test can assert on WHAT WAS WRITTEN rather than on the source
 * text — which is what makes reverting the route fail this suite.
 */
function makeDb(invite) {
  const rec = { inserts: [], updates: [], createUser: null };
  const rowFor = (table) => ({ id: `${table}-row-1` });
  return {
    rec,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        insert(rows) {
          rec.inserts.push({ table, row: rows[0] });
          return chain;
        },
        update(patch) {
          rec.updates.push({ table, patch });
          return chain;
        },
        maybeSingle: async () => ({ data: table === "invitations" ? invite : null, error: null }),
        single: async () => ({ data: rowFor(table), error: null }),
        then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
    createUser(payload) {
      rec.createUser = payload;
      return Promise.resolve({ data: { user: { id: "auth-user-1" } } });
    },
  };
}

const { POST } = await import("@/app/api/invitations/accept/route");

function request() {
  return {
    json: async () => ({
      token: "tok",
      fullName: "Test Person",
      password: "correct horse battery staple",
      termsAccepted: true,
    }),
    headers: { get: () => null },
  };
}

/** Accept an invitation for `role` and return everything that was written. */
async function accept(role) {
  db = makeDb({
    id: "inv-1",
    token: "tok",
    email: `${role}@example.com`,
    role,
    status: "pending",
    organization_id: "org-1",
    expires_at: null,
    project_id: null,
    team_id: null,
    department_id: null,
  });
  const res = await POST(request());
  const body = await res.json();
  return { res, body, rec: db.rec };
}

const profileRowIn = (rec) =>
  rec.inserts.find((i) => ["admin_users", "developers", "clients"].includes(i.table));
const membershipRow = (rec) => rec.inserts.find((i) => i.table === "memberships");

describe("H-3 · one role, one user_type", () => {
  beforeEach(() => {
    db = null;
  });

  it("an INVITED hr gets user_type 'developer', in all three places at once", async () => {
    /**
     * THE BUG: the route computed `isAdminLike = ... || invite.role === "hr"`
     * and wrote "admin". Provisioning wrote "developer" for the same role.
     * "admin" is the LOOSER answer — /api/productivity gates on
     * `userType !== 'admin'`, /api/keyboard-stats self-scopes only for
     * userType "developer", /api/task-submission lets a non-developer userType
     * submit as anyone — so an invited hr escaped all three.
     *
     * All three writes are asserted because they are three separate chances to
     * get it wrong, and the JWT claim is the one that actually grants access.
     */
    const { res, body, rec } = await accept("hr");
    expect(res.status).toBe(200);
    expect(body.userType).toBe("developer");

    expect(profileRowIn(rec).table).toBe("developers");
    expect(membershipRow(rec).row.user_type).toBe("developer");
    expect(rec.createUser.app_metadata.user_type).toBe("developer");

    // No admin_users row is created for them at all.
    expect(rec.inserts.map((i) => i.table)).not.toContain("admin_users");
  });

  it("keeps hr's REAL role on the membership and in the claim", async () => {
    // user_type is storage; role is authorisation. Narrowing the first must not
    // touch the second, or hr loses the people-ops screens it is entitled to.
    const { rec, body } = await accept("hr");
    expect(membershipRow(rec).row.role).toBe("hr");
    expect(rec.createUser.app_metadata.role).toBe("hr");
    expect(body.role).toBe("hr");
  });

  it("agrees with userTypeForRole for EVERY role, which is the actual invariant", async () => {
    /**
     * The finding was a second copy of the mapping, so the test is parity
     * across the whole vocabulary rather than a spot check on hr. A future
     * role added to ROLES is covered without editing this file.
     */
    for (const role of ROLES) {
      const { res, body, rec } = await accept(role);
      const expected = userTypeForRole(role);
      expect(res.status, role).toBe(200);
      expect(body.userType, role).toBe(expected);
      expect(membershipRow(rec).row.user_type, role).toBe(expected);
      expect(rec.createUser.app_metadata.user_type, role).toBe(expected);
      expect(profileRowIn(rec).table, role).toBe(PROFILE_TABLE[expected]);
    }
  });

  it("still files owner and admin in admin_users, and clients in clients", async () => {
    // The no-regression half. Narrowing hr must not have moved anybody else.
    for (const role of ["owner", "admin"]) {
      const { rec, body } = await accept(role);
      expect(body.userType, role).toBe("admin");
      expect(profileRowIn(rec).table, role).toBe("admin_users");
    }
    const { rec, body } = await accept("client");
    expect(body.userType).toBe("client");
    expect(profileRowIn(rec).table).toBe("clients");
  });

  it("files contributors in developers, exactly as before", async () => {
    for (const role of ["developer", "designer", "devops", "qa", "employee", "manager", "team_lead", "finance"]) {
      const { rec, body } = await accept(role);
      expect(body.userType, role).toBe("developer");
      expect(profileRowIn(rec).table, role).toBe("developers");
    }
  });

  it("refuses an unrecognised role instead of defaulting it into `developers`", async () => {
    // userTypeForRole answers "developer" for a typo. That is a fine default
    // for a display decision and a bad one for creating an account, so the
    // route validates first. Fail closed.
    const { res, rec } = await accept("superuser");
    expect(res.status).toBe(400);
    expect(rec.inserts).toHaveLength(0);
    expect(rec.createUser).toBeNull();
    expect(isRole("superuser")).toBe(false);
  });

  it("reads the mapping from utils/roles rather than keeping its own copy", () => {
    /**
     * The source-level half, and deliberately narrow: it asserts that the
     * SECOND COPY is gone, which no behavioural test can see. Runs on stripped
     * JS because the new comment quotes the old `isAdminLike` line verbatim to
     * explain what was wrong — trap (a) again, in a JS file this time.
     */
    const raw = read(ACCEPT);
    const code = stripJs(raw);
    expect(raw).toContain("isAdminLike"); // the header explains it
    expect(code).not.toContain("isAdminLike"); // the code no longer computes it
    expect(code).toContain('from "@/utils/roles"');
    expect(code).toContain("userTypeForRole(invite.role)");
    expect(code).toContain("PROFILE_TABLE[userType]");
    // and no hand-rolled role literal survives in the executable half
    expect(code).not.toMatch(/invite\.role === "hr"/);
    expect(code).not.toMatch(/invite\.role === "owner"/);
  });

  it("roles.js is still the single source, and hr is still staff", () => {
    // If someone "fixes" the disagreement in the other direction — by moving hr
    // to "admin" in roles.js — hr leaves STAFF_ROLES, the Employees directory
    // can no longer create one, and every `userType === 'admin'` branch in the
    // API opens to hr. That is the wrong direction and this pins it.
    expect(userTypeForRole("hr")).toBe("developer");
    expect(PROFILE_TABLE[userTypeForRole("hr")]).toBe("developers");
    expect(STAFF_ROLES).toContain("hr");
    for (const role of ["manager", "team_lead", "qa", "finance"]) {
      expect(userTypeForRole(role), role).toBe("developer");
    }
    expect(userTypeForRole("owner")).toBe("admin");
    expect(userTypeForRole("admin")).toBe("admin");
    expect(userTypeForRole("client")).toBe("client");
  });

  it("the migration records the data that this fix does NOT repair", () => {
    // Existing invited hr accounts keep app_metadata.user_type = 'admin' until
    // a human moves them. The brief forbids silently repairing them; the
    // requirement is that it is written down where the person applying the SQL
    // will see it, with a query to measure it.
    expect(SQL_RAW).toMatch(/FINDING 3/);
    expect(SQL_RAW).toContain("where m.role = 'hr' and m.user_type <> 'developer'");
    // and the measuring query must stay read-only
    expect(SQL_RAW).not.toMatch(/^\s*update public\.memberships/im);
  });
});
