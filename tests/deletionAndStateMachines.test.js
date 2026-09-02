import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The four routes where a wrong answer destroys something.
 *
 * WHY THESE ARE DRIVEN AND NOT GREPPED
 *
 * Every bug pinned here passed a source-scanning test. The delete route
 * "checked the organization"; the change-request route "will not move something
 * somebody else just moved". Both statements were true about the text and false
 * about the behaviour — the org check was in one of two handlers, and the
 * compare-and-swap sat after the write it was supposed to protect. So this file
 * runs the handlers against a fake PostgREST that actually honours filters, and
 * asserts on the ROWS afterwards.
 *
 * WHAT WAS WRONG, in one line each:
 *
 *   1. /api/developer/delete removed every task, submission, metric, log,
 *      review and notification on every project the leaver was assigned to —
 *      by project_id, so everybody else's work went with them — and deleted
 *      the projects. It revoked nothing: the membership survived (the paid
 *      seat with it) and so did the Supabase Auth user, so the "deleted"
 *      person could still sign in.
 *   2. `estimate` on a change request had no stage check, so an APPROVED one
 *      could be walked round the chain again and charged to the project twice.
 *   3. The change request's optimistic lock ran after the budget write, so two
 *      Approve clicks moved the money twice.
 *   4. A REJECTED proposal could be accepted, creating a project off a decision
 *      the client had already been told was final.
 *   5. Project closure wrote with no compare-and-swap at all.
 *
 * THE FAKE. `makeDb` is a small PostgREST: eq / neq / in / is / not / ilike,
 * head counts, update and delete that respect their filters, and an
 * `auth.admin.deleteUser`. Every write appends to `db.log`, which is how the
 * ORDER of the revocation is asserted rather than assumed.
 */

/* ------------------------------------------------------------------ *
 * A database that behaves like PostgREST enough to be lied to by it.
 * ------------------------------------------------------------------ */

let db;

function makeDb(seed = {}) {
  const tables = {
    developers: [],
    memberships: [],
    projects: [],
    developer_tasks: [],
    task_submissions: [],
    productivity_metrics: [],
    activity_logs: [],
    admin_reviews: [],
    notifications: [],
    change_requests: [],
    project_proposals: [],
    project_clients: [],
    milestones: [],
    pm_activity: [],
  };
  for (const [k, v] of Object.entries(seed.tables || {})) tables[k] = v;

  const authUsers = new Set(seed.authUsers || []);
  const log = [];
  const failures = seed.failures || {}; // { table: op } -> forced error

  const value = (row, col) => (Object.prototype.hasOwnProperty.call(row, col) ? row[col] : undefined);
  const blank = (v) => v === null || v === undefined;

  const matches = (row, filters) =>
    filters.every((f) => {
      const v = value(row, f.col);
      switch (f.op) {
        case "eq":
          return !blank(v) && String(v) === String(f.val);
        case "neq":
          return String(v) !== String(f.val);
        case "in":
          return f.val.map(String).includes(String(v));
        case "is":
          return f.val === null ? blank(v) : v === f.val;
        case "notNull":
          return !blank(v);
        case "notIn":
          // `.not("status", "in", settledFilter())` — the filter arrives as a
          // PostgREST list literal, `("completed","cancelled")`.
          return !String(f.val)
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((x) => x.trim().replace(/^"|"$/g, ""))
            .includes(String(v ?? ""));
        case "ilike":
          return String(v ?? "").toLowerCase() === String(f.val).toLowerCase();
        default:
          throw new Error(`fake db: unmodelled filter ${f.op}`);
      }
    });

  function builder(table, op, payload, opts = {}) {
    const filters = [];
    let returning = false;

    async function run(mode) {
      // Yields to the microtask queue exactly once per call, so two handlers
      // started together interleave the way two requests do.
      await Promise.resolve();

      if (failures[table] === op) {
        return { data: null, count: null, error: { message: `forced ${op} failure on ${table}` } };
      }

      const rows = tables[table].filter((r) => matches(r, filters));

      if (op === "select") {
        if (opts.head || opts.count) {
          return { data: null, count: rows.length, error: null };
        }
        return finish(rows.map((r) => ({ ...r })));
      }

      if (op === "update") {
        rows.forEach((r) => Object.assign(r, payload));
        log.push({ op: "update", table, rows: rows.length });
        return finish(rows.map((r) => ({ ...r })));
      }

      if (op === "delete") {
        tables[table] = tables[table].filter((r) => !matches(r, filters));
        log.push({ op: "delete", table, rows: rows.length });
        return finish(rows.map((r) => ({ ...r })));
      }

      throw new Error(`fake db: unmodelled op ${op}`);

      function finish(data) {
        if (mode === "maybeSingle") return { data: data[0] ?? null, count: null, error: null };
        if (mode === "single") {
          if (data.length !== 1) {
            return {
              data: null,
              count: null,
              // The shape PostgREST returns for "no rows", which the routes
              // that still use .single() turn into a thrown error.
              error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
            };
          }
          return { data: data[0], count: null, error: null };
        }
        return { data, count: data.length, error: null };
      }
    }

    const b = {
      eq: (col, val) => (filters.push({ op: "eq", col, val }), b),
      neq: (col, val) => (filters.push({ op: "neq", col, val }), b),
      in: (col, val) => (filters.push({ op: "in", col, val }), b),
      ilike: (col, val) => (filters.push({ op: "ilike", col, val }), b),
      is: (col, val) => (filters.push({ op: "is", col, val }), b),
      not: (col, operator, val) => {
        if (operator === "is" && val === null) filters.push({ op: "notNull", col });
        else if (operator === "in") filters.push({ op: "notIn", col, val });
        else throw new Error(`fake db: unmodelled not(${col}, ${operator})`);
        return b;
      },
      select: () => ((returning = true), b),
      maybeSingle: () => run("maybeSingle"),
      single: () => run("single"),
      then: (res, rej) => run("many").then(res, rej),
    };
    void returning;
    return b;
  }

  const client = {
    from(table) {
      if (!tables[table]) tables[table] = [];
      return {
        select: (cols, opts) => builder(table, "select", null, opts || {}),
        update: (patch) => builder(table, "update", patch),
        delete: () => builder(table, "delete"),
        insert: (rows) => {
          // Chainable, because inserts in these routes are written
          // `.insert(row).select().single()` — the created row is used.
          const write = async () => {
            await Promise.resolve();
            if (failures[table] === "insert") {
              return { data: null, error: { message: `forced insert failure on ${table}` } };
            }
            const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
              id: r.id || `${table}-${tables[table].length + 1}`,
              ...r,
            }));
            list.forEach((r) => tables[table].push(r));
            log.push({ op: "insert", table, rows: list.length });
            return { data: list, error: null };
          };
          const ib = {
            select: () => ib,
            single: async () => {
              const { data, error } = await write();
              return { data: data ? data[0] : null, error };
            },
            maybeSingle: async () => {
              const { data, error } = await write();
              return { data: data ? data[0] ?? null : null, error };
            },
            then: (res, rej) => write().then(res, rej),
          };
          return ib;
        },
      };
    },
    auth: {
      admin: {
        deleteUser: async (id) => {
          await Promise.resolve();
          if (seed.failAuthDelete) {
            log.push({ op: "auth.deleteUser.failed", table: "auth.users" });
            return { data: null, error: { status: 500, message: "service unavailable" } };
          }
          if (!authUsers.has(id)) {
            return { data: null, error: { status: 404, message: "User not found" } };
          }
          authUsers.delete(id);
          log.push({ op: "auth.deleteUser", table: "auth.users" });
          return { data: {}, error: null };
        },
      },
    },
  };

  return { tables, authUsers, log, client };
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

// The delete route builds its own client at import time; the other three ask
// serverAuth for one. Both are pointed at whichever `db` the current test made.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (t) => db.client.from(t),
    auth: { admin: { deleteUser: (id) => db.client.auth.admin.deleteUser(id) } },
  }),
}));

vi.mock("@/utils/serverAuth", () => ({
  getAuthedOrg: vi.fn(),
  serviceClient: () => db.client,
}));

// Billing is not what any of this is about; an unlocked org keeps the proposal
// route on the path under test.
vi.mock("@/utils/entitlements", () => ({ requireUnlocked: async () => null }));

const { getAuthedOrg } = await import("@/utils/serverAuth");
const DEV_DELETE = await import("@/app/api/developer/delete/route.js");
const { POST: advance } = await import("@/app/api/change-requests/[id]/advance/route.js");
const { POST: decide } = await import("@/app/api/proposals/[id]/decide/route.js");
const { POST: closure } = await import("@/app/api/projects/[id]/closure/route.js");

const ORG = "org-acme";
const OTHER_ORG = "org-globex";

/** A verified caller, as getAuthedOrg() returns them. */
function actor(overrides = {}) {
  return {
    token: "t",
    userId: "auth-owner",
    email: "owner@acme.test",
    orgId: ORG,
    role: "owner",
    userType: "admin",
    appUserId: "app-owner",
    overrides: {},
    overridesUnavailable: false,
    ...overrides,
  };
}

const jsonRequest = (body) => ({ json: async () => body, headers: { get: () => null } });
const urlRequest = (url) => ({ url, headers: { get: () => null } });

async function readJson(res) {
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* =================================================================== *
 * 1. DELETE /api/developer/delete
 * =================================================================== */

const LEAVER = "dev-leaver";
const COLLEAGUE = "dev-colleague";
const LEAVER_AUTH = "auth-leaver";
const PROJECT = "proj-shared";

function seedDeletion(extra = {}) {
  return makeDb({
    authUsers: [LEAVER_AUTH, "auth-colleague"],
    tables: {
      developers: [
        {
          id: LEAVER,
          name: "Dana",
          email: "dana@acme.test",
          organization_id: ORG,
          auth_user_id: LEAVER_AUTH,
          added_by: "app-owner",
          added_by_admin: "owner@acme.test",
        },
        {
          id: COLLEAGUE,
          name: "Sam",
          email: "sam@acme.test",
          organization_id: ORG,
          auth_user_id: "auth-colleague",
          added_by: "app-owner",
          added_by_admin: "owner@acme.test",
        },
        {
          id: "dev-foreign",
          name: "Rival",
          email: "rival@globex.test",
          organization_id: OTHER_ORG,
          auth_user_id: "auth-foreign",
        },
      ],
      memberships: [
        { id: "m-leaver", organization_id: ORG, user_id: LEAVER, user_type: "developer", role: "developer", status: "active" },
        { id: "m-colleague", organization_id: ORG, user_id: COLLEAGUE, user_type: "developer", role: "developer", status: "active" },
      ],
      projects: [
        // A shared project: the leaver is assigned, the colleague works on it.
        { id: PROJECT, organization_id: ORG, name: "Client site", assigned_to: LEAVER, assigned_developer_id: null, budget: 10000 },
        { id: "proj-other", organization_id: ORG, name: "Untouched", assigned_to: COLLEAGUE, assigned_developer_id: null, budget: 500 },
      ],
      developer_tasks: [
        { id: "t-leaver", organization_id: ORG, project_id: PROJECT, developer_id: LEAVER },
        { id: "t-colleague-1", organization_id: ORG, project_id: PROJECT, developer_id: COLLEAGUE },
        { id: "t-colleague-2", organization_id: ORG, project_id: PROJECT, developer_id: COLLEAGUE },
      ],
      task_submissions: [
        { id: "s-leaver", project_id: PROJECT, developer_id: LEAVER },
        { id: "s-colleague", project_id: PROJECT, developer_id: COLLEAGUE },
      ],
      productivity_metrics: [
        { id: "pm-leaver", project_id: PROJECT, developer_id: LEAVER },
        { id: "pm-colleague", project_id: PROJECT, developer_id: COLLEAGUE },
      ],
      activity_logs: [
        { id: "a-leaver", organization_id: ORG, project_id: PROJECT, developer_id: LEAVER },
        { id: "a-colleague", organization_id: ORG, project_id: PROJECT, developer_id: COLLEAGUE },
      ],
      admin_reviews: [
        { id: "r-leaver", project_id: PROJECT, developer_id: LEAVER },
        { id: "r-colleague", project_id: PROJECT, developer_id: COLLEAGUE },
      ],
      notifications: [
        { id: "n-leaver", project_id: PROJECT, developer_id: LEAVER },
        { id: "n-colleague", project_id: PROJECT, developer_id: COLLEAGUE },
      ],
    },
    ...extra,
  });
}

const deleteBody = (developerId = LEAVER) => ({
  developerId,
  developerEmail: "",
  userId: "",
  adminId: "app-owner",
  adminEmail: "owner@acme.test",
});

async function runDelete({ auth = actor(), body = deleteBody() } = {}) {
  getAuthedOrg.mockResolvedValue(auth);
  return readJson(await DEV_DELETE.DELETE(jsonRequest(body)));
}

async function runPreview({ auth = actor(), developerId = LEAVER } = {}) {
  getAuthedOrg.mockResolvedValue(auth);
  return readJson(
    await DEV_DELETE.GET(urlRequest(`https://acme.test/api/developer/delete?developerId=${developerId}`))
  );
}

const ids = (table) => db.tables[table].map((r) => r.id).sort();

describe("deleting one person does not delete everybody else's work", () => {
  beforeEach(() => {
    db = seedDeletion();
  });

  it("removes the leaver's own rows and NOTHING keyed to a colleague", async () => {
    const { status } = await runDelete();
    expect(status).toBe(200);

    // The exact rows. Anything looser passes for a delete that took the lot.
    expect(ids("developer_tasks")).toEqual(["t-colleague-1", "t-colleague-2"]);
    expect(ids("task_submissions")).toEqual(["s-colleague"]);
    expect(ids("productivity_metrics")).toEqual(["pm-colleague"]);
    expect(ids("activity_logs")).toEqual(["a-colleague"]);
    expect(ids("admin_reviews")).toEqual(["r-colleague"]);
    expect(ids("notifications")).toEqual(["n-colleague"]);
    expect(ids("developers")).toEqual(["dev-colleague", "dev-foreign"]);
  });

  it("keeps the projects, and unassigns them", async () => {
    await runDelete();
    // The project is the organization's. It had a budget and a client's work on
    // it, and the old route deleted it because one of its assignees left.
    expect(ids("projects")).toEqual(["proj-other", PROJECT]);
    const shared = db.tables.projects.find((p) => p.id === PROJECT);
    expect(shared.assigned_to).toBeNull();
    expect(shared.budget).toBe(10000);
  });

  it("unassigns the OTHER assignment column too", async () => {
    db.tables.projects.push({
      id: "proj-second",
      organization_id: ORG,
      assigned_to: null,
      assigned_developer_id: LEAVER,
      budget: 1,
    });
    await runDelete();
    const second = db.tables.projects.find((p) => p.id === "proj-second");
    expect(second).toBeTruthy();
    expect(second.assigned_developer_id).toBeNull();
  });

  it("touches nothing in another organization", async () => {
    db.tables.developer_tasks.push({ id: "t-foreign", organization_id: OTHER_ORG, developer_id: "dev-foreign" });
    db.tables.projects.push({ id: "proj-foreign", organization_id: OTHER_ORG, assigned_to: "dev-foreign" });
    await runDelete();
    expect(db.tables.developer_tasks.some((t) => t.id === "t-foreign")).toBe(true);
    expect(db.tables.projects.some((p) => p.id === "proj-foreign")).toBe(true);
  });

  it("reports what it actually did", async () => {
    const { body } = await runDelete();
    expect(body.deletionSummary.relatedDataDeleted).toEqual({
      tasks: 1,
      submissions: 1,
      activities: 1,
    });
    expect(body.deletionSummary.projectsUnassigned).toBe(1);
  });
});

describe("the confirmation dialog is told the truth", () => {
  beforeEach(() => {
    db = seedDeletion();
  });

  it("previews exactly the rows the delete then removes", async () => {
    // THE BUG: the preview counted `developer_id` while the delete removed by
    // `project_id`. It said "Tasks: 1" and removed three. Counted here from the
    // real tables before and after, so the two cannot be made to agree by
    // editing one of them.
    const before = await runPreview();
    const tasksBefore = db.tables.developer_tasks.length;
    const submissionsBefore = db.tables.task_submissions.length;
    const activitiesBefore = db.tables.activity_logs.length;

    await runDelete();

    expect(tasksBefore - db.tables.developer_tasks.length).toBe(before.body.impact.tasks);
    expect(submissionsBefore - db.tables.task_submissions.length).toBe(before.body.impact.submissions);
    expect(activitiesBefore - db.tables.activity_logs.length).toBe(before.body.impact.activities);
  });

  it("counts projects as kept, and says so", async () => {
    const { body } = await runPreview();
    expect(body.impact.projects).toBe(1);
    expect(body.warning).toMatch(/kept/i);
    // The old wording promised the opposite, which is the sentence somebody
    // read before clicking through.
    expect(body.warning).not.toMatch(/permanently deleted/i);
  });

  it("still refuses to preview another tenant's person", async () => {
    const { status, body } = await runPreview({ developerId: "dev-foreign" });
    expect(status).toBe(404);
    expect(body.error).toBe("Developer not found.");
  });
});

describe("deletion revokes access, and does it first", () => {
  beforeEach(() => {
    db = seedDeletion();
  });

  it("deletes the Supabase Auth user, so they cannot sign in again", async () => {
    // Before the fix the word `deleteUser` did not appear in the route. A
    // deleted employee kept a valid JWT carrying org, role and app_user_id.
    expect(db.authUsers.has(LEAVER_AUTH)).toBe(true);
    const { body } = await runDelete();
    expect(db.authUsers.has(LEAVER_AUTH)).toBe(false);
    expect(db.authUsers.has("auth-colleague")).toBe(true);
    expect(body.deletionSummary.accessRevoked.login).toBe(true);
  });

  it("removes the membership, so the paid seat is freed", async () => {
    // entitlements.js counts membership rows. A membership that outlives its
    // person is a seat the organization keeps paying for and cannot see.
    await runDelete();
    expect(ids("memberships")).toEqual(["m-colleague"]);
  });

  it("revokes BEFORE it destroys anything", async () => {
    await runDelete();
    const first = db.log.findIndex((e) => e.op === "auth.deleteUser");
    const seat = db.log.findIndex((e) => e.op === "delete" && e.table === "memberships");
    const firstDestruction = db.log.findIndex(
      (e) => e.op === "delete" && !["memberships"].includes(e.table)
    );
    expect(first).toBe(0);
    expect(seat).toBeGreaterThan(first);
    expect(firstDestruction).toBeGreaterThan(seat);
  });

  it("destroys NOTHING when the login cannot be revoked", async () => {
    db = seedDeletion({ failAuthDelete: true });
    const { status } = await runDelete();
    expect(status).toBe(503);
    // Every row still there, including the person.
    expect(ids("developers")).toContain(LEAVER);
    expect(ids("memberships")).toContain("m-leaver");
    expect(ids("developer_tasks")).toContain("t-leaver");
    expect(db.log.filter((e) => e.op === "delete")).toHaveLength(0);
  });

  it("finishes a half-run deletion instead of refusing it", async () => {
    // A previous attempt got as far as the auth user. Re-running must complete,
    // not fail on a step that is already done.
    db.authUsers.delete(LEAVER_AUTH);
    const { status } = await runDelete();
    expect(status).toBe(200);
    expect(ids("developers")).not.toContain(LEAVER);
    expect(ids("memberships")).toEqual(["m-colleague"]);
  });

  it("says so rather than implying a revocation when no login is linked", async () => {
    db.tables.developers.find((d) => d.id === LEAVER).auth_user_id = null;
    const { status, body } = await runDelete();
    expect(status).toBe(200);
    expect(body.deletionSummary.accessRevoked.login).toBe(false);
  });
});

describe("who may run the most destructive route in the product", () => {
  beforeEach(() => {
    db = seedDeletion();
  });

  const untouched = () => {
    expect(ids("developers")).toContain(LEAVER);
    expect(ids("developer_tasks")).toContain("t-leaver");
    expect(ids("memberships")).toContain("m-leaver");
    expect(db.authUsers.has(LEAVER_AUTH)).toBe(true);
  };

  it("honours a per-person DENY, which the hand-typed role list ignored", async () => {
    // THE POINT OF FINDING 1b. `["owner","admin"].includes(auth.role)` admits
    // the same two roles as `member.delete` and consults no override, so a DENY
    // written against one named admin was honoured everywhere in the product
    // except here.
    const { status } = await runDelete({
      auth: actor({ role: "admin", overrides: { "member.delete": false } }),
    });
    expect(status).toBe(403);
    untouched();
  });

  it("honours the deny even for an owner", async () => {
    const { status } = await runDelete({
      auth: actor({ overrides: { "member.delete": false } }),
    });
    expect(status).toBe(403);
    untouched();
  });

  it.each(["manager", "team_lead", "hr", "developer", "qa"])(
    "refuses a %s — member.delete is owner/admin",
    async (role) => {
      const { status } = await runDelete({ auth: actor({ role }) });
      expect(status).toBe(403);
      untouched();
    }
  );

  it("refuses a client whatever their role claim says", async () => {
    const { status } = await runDelete({ auth: actor({ userType: "client" }) });
    expect(status).toBe(403);
    untouched();
  });

  it("refuses when the overrides could not be read, rather than falling back to the role", async () => {
    const { status } = await runDelete({ auth: actor({ overridesUnavailable: true }) });
    expect(status).toBe(503);
    untouched();
  });

  it("refuses an unauthenticated caller", async () => {
    const { status } = await runDelete({ auth: null });
    expect(status).toBe(401);
    untouched();
  });

  it("refuses a developer belonging to another organization", async () => {
    const { status } = await runDelete({ body: deleteBody("dev-foreign") });
    expect(status).toBe(404);
    expect(ids("developers")).toContain("dev-foreign");
  });

  it("refuses to delete the caller's own account", async () => {
    const { status } = await runDelete({
      auth: actor({ role: "admin", appUserId: LEAVER }),
    });
    expect(status).toBe(400);
    untouched();
  });

  it("enforces the 'only what you added' rule the browser had been enforcing alone", async () => {
    // isAdminAuthorizedForDeveloper was defined and called from nowhere while
    // developerDeletion.js claimed the route repeated it against the verified
    // token. An admin who did not add this person is now refused...
    const stranger = actor({ role: "admin", appUserId: "app-other", email: "other@acme.test" });
    expect((await runDelete({ auth: stranger })).status).toBe(403);
    untouched();

    // ...and the owner is not, because somebody has to be able to clean up
    // after an admin who has left themselves.
    const owner = actor({ appUserId: "app-other", email: "other@acme.test" });
    expect((await runDelete({ auth: owner })).status).toBe(200);
  });

  it("compares against the TOKEN, not the adminId in the body", async () => {
    // The body is caller-supplied. If it were trusted, the check would be
    // self-certifying: anyone could claim to be the person who added them.
    const stranger = actor({ role: "admin", appUserId: "app-other", email: "other@acme.test" });
    const { status } = await runDelete({
      auth: stranger,
      body: { ...deleteBody(), adminId: "app-owner", adminEmail: "owner@acme.test" },
    });
    expect(status).toBe(403);
    untouched();
  });
});

/* =================================================================== *
 * 2 & 3. POST /api/change-requests/[id]/advance
 * =================================================================== */

const CR = "cr-1";
const CR_PROJECT = "proj-cr";

function seedChangeRequest(cr = {}) {
  return makeDb({
    tables: {
      projects: [{ id: CR_PROJECT, organization_id: ORG, budget: 10000, deadline: "2026-01-01" }],
      project_clients: [{ organization_id: ORG, project_id: CR_PROJECT, client_id: "client-1" }],
      memberships: [],
      change_requests: [
        {
          id: CR,
          organization_id: ORG,
          project_id: CR_PROJECT,
          title: "Extra page",
          status: "awaiting_client",
          estimated_cost: 2000,
          estimated_hours: 10,
          timeline_impact_days: 7,
          currency: "USD",
          admin_decided_at: "2026-01-01T00:00:00.000Z",
          client_decided_at: null,
          applied_at: null,
          previous_budget: null,
          previous_deadline: null,
          requested_by: "client-1",
          ...cr,
        },
      ],
    },
  });
}

const CLIENT = actor({
  role: "client",
  userType: "client",
  appUserId: "client-1",
  email: "client@acme.test",
});
const PM = actor({ role: "manager", userType: "developer", appUserId: "app-pm" });

async function runAdvance(body, auth = PM) {
  getAuthedOrg.mockResolvedValue(auth);
  return readJson(await advance(jsonRequest(body), { params: { id: CR } }));
}

const theCr = () => db.tables.change_requests.find((r) => r.id === CR);
const theCrProject = () => db.tables.projects.find((p) => p.id === CR_PROJECT);

describe("a change request cannot be charged to the project twice", () => {
  it("refuses to re-estimate one that has already been approved", async () => {
    // The hole: database/060 blocks reopening from implemented, rejected and
    // withdrawn — and NOT from approved. So an approved request could be
    // re-estimated, walked forward, and applied a second time.
    db = seedChangeRequest({ status: "approved", applied_at: "2026-02-01T00:00:00.000Z", previous_budget: 10000 });
    db.tables.projects[0].budget = 12000;

    const { status, body } = await runAdvance({ action: "estimate", estimatedCost: 2000 });
    expect(status).toBe(409);
    expect(body.error).toMatch(/approved/);
    expect(theCr().status).toBe("approved");
    expect(theCrProject().budget).toBe(12000);
  });

  it("refuses to re-estimate an implemented one", async () => {
    db = seedChangeRequest({ status: "implemented", applied_at: "2026-02-01T00:00:00.000Z" });
    expect((await runAdvance({ action: "estimate", estimatedCost: 1 })).status).toBe(409);
    expect(theCr().status).toBe("implemented");
  });

  it("still allows the pricing it exists for", async () => {
    // The stage check must not be a blanket refusal — that would pass every
    // "cannot be charged twice" assertion above while breaking the feature.
    db = seedChangeRequest({ status: "submitted", estimated_cost: null, estimated_hours: null });
    const { status } = await runAdvance({ action: "estimate", estimatedCost: 2500 });
    expect(status).toBe(200);
    expect(theCr().status).toBe("awaiting_admin");
    expect(theCr().estimated_cost).toBe(2500);
  });

  it("still allows a re-price while the client is looking at it", async () => {
    db = seedChangeRequest({ status: "awaiting_client" });
    const { status } = await runAdvance({ action: "estimate", estimatedCost: 3000 });
    expect(status).toBe(200);
    expect(theCr().status).toBe("awaiting_admin");
  });

  it("refuses a staff rejection of something already agreed", async () => {
    // Nothing in a rejection moves the budget back, so the project would keep
    // money for work the record says was declined.
    db = seedChangeRequest({ status: "approved", client_decided_at: "2026-02-01T00:00:00.000Z" });
    const { status } = await runAdvance({ action: "reject", reason: "changed our minds" });
    expect(status).toBe(409);
    expect(theCr().status).toBe("approved");
  });

  it("still lets staff decline one that is still in flight", async () => {
    db = seedChangeRequest({ status: "awaiting_admin" });
    const { status } = await runAdvance({ action: "reject", reason: "too expensive for us" });
    expect(status).toBe(200);
    expect(theCr().status).toBe("rejected");
  });

  it("refuses an approval of a request that was somehow already applied", async () => {
    db = seedChangeRequest({ applied_at: "2026-02-01T00:00:00.000Z" });
    const { status } = await runAdvance({ action: "client_approve" }, CLIENT);
    expect(status).toBe(409);
    expect(theCrProject().budget).toBe(10000);
  });
});

describe("two Approve clicks move the money once", () => {
  beforeEach(() => {
    db = seedChangeRequest();
  });

  it("lets exactly one through, and answers the other 409", async () => {
    // THE RACE. Both requests read `awaiting_client`; with the lock sitting
    // after applyImpact both added 2000 to the budget and then one of them
    // answered 503. Driven concurrently, not asserted about the source, because
    // the source read correctly the whole time.
    getAuthedOrg.mockResolvedValue(CLIENT);
    const [a, b] = await Promise.all([
      advance(jsonRequest({ action: "client_approve" }), { params: { id: CR } }),
      advance(jsonRequest({ action: "client_approve" }), { params: { id: CR } }),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);
    expect(theCrProject().budget).toBe(12000);
    expect(theCr().status).toBe("approved");
  });

  it("moves the deadline once as well", async () => {
    getAuthedOrg.mockResolvedValue(CLIENT);
    await Promise.all([
      advance(jsonRequest({ action: "client_approve" }), { params: { id: CR } }),
      advance(jsonRequest({ action: "client_approve" }), { params: { id: CR } }),
    ]);
    expect(theCrProject().deadline).toBe("2026-01-08");
  });

  it("records the budget it started from, not the one it just inflated", async () => {
    // `previous_budget` is what unwinds the change. A second application
    // overwrote it with the already-inflated figure and the trail became a lie.
    const { status } = await runAdvance({ action: "client_approve" }, CLIENT);
    expect(status).toBe(200);
    expect(theCr().previous_budget).toBe(10000);
    expect(theCr().applied_at).toBeTruthy();
  });

  it("answers a lost race 409 and not 503", async () => {
    // 503 means "the server broke", and a client retries it — here that means
    // asking again for the money to move.
    db.tables.change_requests[0].status = "awaiting_client";
    getAuthedOrg.mockResolvedValue(CLIENT);
    const [a, b] = await Promise.all([
      advance(jsonRequest({ action: "client_approve" }), { params: { id: CR } }),
      advance(jsonRequest({ action: "client_approve" }), { params: { id: CR } }),
    ]);
    const loser = [a, b].find((r) => r.status !== 200);
    expect(loser.status).toBe(409);
    expect(await loser.json()).toMatchObject({ error: expect.stringMatching(/somebody else/i) });
  });

  it("puts the approval back when the budget write fails", async () => {
    // The cost of winning the transition first: a failure would otherwise leave
    // a request claiming an approval the project never got.
    db = makeDb({
      failures: { projects: "update" },
      tables: {
        projects: [{ id: CR_PROJECT, organization_id: ORG, budget: 10000, deadline: "2026-01-01" }],
        project_clients: [{ organization_id: ORG, project_id: CR_PROJECT, client_id: "client-1" }],
        change_requests: [
          {
            id: CR,
            organization_id: ORG,
            project_id: CR_PROJECT,
            title: "Extra page",
            status: "awaiting_client",
            estimated_cost: 2000,
            timeline_impact_days: 7,
            admin_decided_at: "2026-01-01T00:00:00.000Z",
            client_decided_at: null,
            applied_at: null,
          },
        ],
      },
    });

    const { status } = await runAdvance({ action: "client_approve" }, CLIENT);
    expect(status).toBe(503);
    expect(theCr().status).toBe("awaiting_client");
    expect(theCr().client_decided_at).toBeNull();
    expect(theCrProject().budget).toBe(10000);
  });
});

/* =================================================================== *
 * 4. POST /api/proposals/[id]/decide
 * =================================================================== */

const PROPOSAL = "prop-1";

function seedProposal(status) {
  return makeDb({
    tables: {
      project_proposals: [
        {
          id: PROPOSAL,
          organization_id: ORG,
          client_id: "client-1",
          title: "A new site",
          description: "…",
          status,
          budget: 5000,
          estimated_cost: 6000,
          estimated_timeline_days: 30,
          decision_reason: status === "rejected" ? "not for us" : null,
        },
      ],
      projects: [],
      project_clients: [],
      memberships: [],
    },
  });
}

async function runDecide(body, auth = actor({ role: "admin" })) {
  getAuthedOrg.mockResolvedValue(auth);
  return readJson(await decide(jsonRequest(body), { params: { id: PROPOSAL } }));
}

const theProposal = () => db.tables.project_proposals[0];

describe("a declined proposal stays declined", () => {
  it("refuses to accept one that was rejected", async () => {
    // It created a project, linked the client and assigned a manager off a
    // decision the client had already been told was final.
    db = seedProposal("rejected");
    const { status, body } = await runDecide({ decision: "accepted" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/declined/i);
    expect(db.tables.projects).toHaveLength(0);
    expect(db.tables.project_clients).toHaveLength(0);
    expect(theProposal().status).toBe("rejected");
  });

  it("refuses to re-estimate one that was rejected back into the queue", async () => {
    db = seedProposal("rejected");
    const { status } = await runDecide({ decision: "estimate", estimatedCost: 1000 });
    expect(status).toBe(409);
    expect(theProposal().status).toBe("rejected");
  });

  it("refuses to turn it into a needs_info", async () => {
    db = seedProposal("rejected");
    const { status } = await runDecide({ decision: "needs_info", reason: "one more thing" });
    expect(status).toBe(409);
    expect(theProposal().status).toBe("rejected");
  });

  it("still refuses to re-decide an accepted one", async () => {
    db = seedProposal("accepted");
    const { status, body } = await runDecide({ decision: "rejected", reason: "no" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/accepted/i);
  });

  it("still accepts a live proposal — the terminal check is not a blanket refusal", async () => {
    db = seedProposal("in_review");
    const { status } = await runDecide({ decision: "accepted" });
    expect(status).toBe(200);
    expect(theProposal().status).toBe("accepted");
    expect(db.tables.projects).toHaveLength(1);
    expect(db.tables.project_clients).toHaveLength(1);
  });

  it("keeps a decline that lands while an accept is in flight", async () => {
    /**
     * THE WRITE-LEVEL LOCK, which the read-level check above does not cover.
     * Two admins deciding at once: the decline commits while the accept is
     * still creating the project and linking the client. Without
     * `.neq("status", "rejected")` on the accept's own write, the proposal ends
     * up accepted with a live project behind it — off a refusal the client has
     * already been sent, and with no record that it was ever refused.
     */
    db = seedProposal("in_review");
    getAuthedOrg.mockResolvedValue(actor({ role: "admin" }));
    const [rejected, accepted] = await Promise.all([
      decide(jsonRequest({ decision: "rejected", reason: "not this quarter" }), {
        params: { id: PROPOSAL },
      }),
      decide(jsonRequest({ decision: "accepted" }), { params: { id: PROPOSAL } }),
    ]);

    expect(rejected.status).toBe(200);
    expect(accepted.status).not.toBe(200);
    expect(theProposal().status).toBe("rejected");
    // And the project the accept had already created is unwound, rather than
    // left behind as a project nobody agreed to.
    expect(db.tables.projects).toHaveLength(0);
    expect(db.tables.project_clients).toHaveLength(0);
  });

  it("still lets a live proposal be declined", async () => {
    db = seedProposal("submitted");
    const { status } = await runDecide({ decision: "rejected", reason: "not this quarter" });
    expect(status).toBe(200);
    expect(theProposal().status).toBe("rejected");
  });
});

/* =================================================================== *
 * 5. POST /api/projects/[id]/closure
 * =================================================================== */

const CLOSURE_PROJECT = "proj-closing";

function seedClosure(project = {}) {
  return makeDb({
    tables: {
      projects: [
        {
          id: CLOSURE_PROJECT,
          organization_id: ORG,
          name: "Site",
          status: "active",
          manager_id: null,
          completed_at: null,
          completed_by: null,
          client_signed_off_at: null,
          client_rating: null,
          client_feedback: null,
          closed_at: null,
          closed_by: null,
          closure_note: null,
          ...project,
        },
      ],
      milestones: [{ organization_id: ORG, project_id: CLOSURE_PROJECT, status: "completed" }],
      developer_tasks: [],
      project_clients: [{ organization_id: ORG, project_id: CLOSURE_PROJECT, client_id: "client-1" }],
      pm_activity: [],
    },
  });
}

const closureRequest = (body) => closure(jsonRequest(body), { params: { id: CLOSURE_PROJECT } });
const theClosureProject = () => db.tables.projects[0];

describe("closing a project is a step somebody takes once", () => {
  it("lets one of two simultaneous completions win", async () => {
    // Both read `completed_at: null`, both passed the 409 gate, and both wrote:
    // two pm_activity rows and the second caller recorded as the completer.
    db = seedClosure();
    getAuthedOrg.mockResolvedValue(actor());
    const [a, b] = await Promise.all([
      closureRequest({ action: "complete" }),
      closureRequest({ action: "complete" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.tables.pm_activity.filter((r) => r.action === "project_completed")).toHaveLength(1);
    expect(theClosureProject().completed_by).toBe("app-owner");
  });

  it("lets one of two simultaneous closes win", async () => {
    db = seedClosure({ completed_at: "2026-03-01T00:00:00.000Z", status: "completed" });
    getAuthedOrg.mockResolvedValue(actor());
    const [a, b] = await Promise.all([
      closureRequest({ action: "close", note: "one" }),
      closureRequest({ action: "close", note: "two" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.tables.pm_activity.filter((r) => r.action === "project_closed")).toHaveLength(1);
  });

  it("lets one of two simultaneous reopens win", async () => {
    db = seedClosure({
      completed_at: "2026-03-01T00:00:00.000Z",
      closed_at: "2026-03-02T00:00:00.000Z",
      status: "closed",
    });
    getAuthedOrg.mockResolvedValue(actor());
    const [a, b] = await Promise.all([
      closureRequest({ action: "reopen" }),
      closureRequest({ action: "reopen" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(theClosureProject().closed_at).toBeNull();
  });

  it("lets one of two simultaneous sign-offs win", async () => {
    db = seedClosure({ completed_at: "2026-03-01T00:00:00.000Z", status: "completed" });
    getAuthedOrg.mockResolvedValue(
      actor({ role: "client", userType: "client", appUserId: "client-1" })
    );
    const [a, b] = await Promise.all([
      closureRequest({ action: "sign_off", rating: 5 }),
      closureRequest({ action: "sign_off", rating: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(theClosureProject().client_rating).toBe(5);
  });

  it("still completes when nobody is racing — the lock is not a wall", async () => {
    db = seedClosure();
    getAuthedOrg.mockResolvedValue(actor());
    const res = await closureRequest({ action: "complete" });
    expect(res.status).toBe(200);
    expect(theClosureProject().completed_at).toBeTruthy();
    expect(theClosureProject().status).toBe("completed");
  });

  it("still refuses to complete over open work", async () => {
    db = seedClosure();
    db.tables.milestones.push({ organization_id: ORG, project_id: CLOSURE_PROJECT, status: "in_progress" });
    getAuthedOrg.mockResolvedValue(actor());
    const res = await closureRequest({ action: "complete" });
    expect(res.status).toBe(409);
    expect(theClosureProject().completed_at).toBeNull();
  });
});
