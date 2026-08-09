import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Deleting a team is ONE operation, or it is nothing.
 *
 * Deleting a team has two effects — detach every member
 * (memberships.team_id -> null) and remove the teams row. The browser used to
 * do both itself, as two PostgREST round-trips. Two round-trips are two
 * transactions: when the second failed, the first stayed committed and every
 * member of that team was left detached from a team that still existed, with
 * no repair but re-assigning each person by hand.
 *
 * Both writes now live inside public.delete_team_with_members (migration 043),
 * called by DELETE /api/admin/teams/[id]. A function body runs in one
 * transaction, so both commit or neither does.
 *
 * These tests pin the four things that keep that true:
 *   1. an unauthorised caller is refused before anything is read or written,
 *   2. a team in another organisation is reported as NOT FOUND, not forbidden,
 *      so the response cannot be used to probe which ids exist elsewhere,
 *   3. on success BOTH effects are applied — and the members survive as
 *      members, because "delete a team" must not become "remove those people",
 *   4. when the delete fails, NEITHER effect survives.
 *
 * The fake below is the point of (3) and (4): it models the SQL function's
 * transaction by snapshotting the rows and restoring them if the delete
 * raises. That is the behaviour database/043_team_delete.sql was validated for
 * against postgres:16-alpine; here it is the contract the route is written
 * against.
 */

vi.mock("@/utils/serverAuth", () => ({
  getAuthedOrg: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock("@/utils/systemEvents", () => ({
  recordEvent: vi.fn(async () => true),
}));

const { getAuthedOrg, serviceClient } = await import("@/utils/serverAuth");
const { authorizeTeamDelete, isTeamId, TEAM_MANAGERS } = await import(
  "@/app/api/admin/teams/[id]/authorize"
);
const { DELETE } = await import("@/app/api/admin/teams/[id]/route");

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FOREIGN_TEAM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ABSENT_TEAM = "99999999-9999-9999-9999-999999999999";

/** A verified caller, as getAuthedOrg() returns them. */
function actor(role, overrides = {}) {
  return {
    token: "t",
    userId: "auth-actor",
    email: "actor@example.com",
    orgId: ORG,
    role,
    userType: "admin",
    appUserId: "actor-app-id",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * A database that behaves like the SQL function, transaction included.
 * ------------------------------------------------------------------ */
function makeDb({ failDelete = false, rpcError = null } = {}) {
  const db = {
    teams: [
      { id: TEAM, organization_id: ORG, name: "Frontend" },
      { id: FOREIGN_TEAM, organization_id: OTHER_ORG, name: "Globex Squad" },
    ],
    memberships: [
      { id: "m1", organization_id: ORG, email: "a@acme.test", team_id: TEAM },
      { id: "m2", organization_id: ORG, email: "b@acme.test", team_id: TEAM },
      { id: "m3", organization_id: ORG, email: "c@acme.test", team_id: null },
      { id: "m4", organization_id: OTHER_ORG, email: "d@globex.test", team_id: FOREIGN_TEAM },
    ],
  };

  const calls = [];

  const svc = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      if (name !== "delete_team_with_members") {
        return { data: null, error: { message: `unknown function ${name}` } };
      }

      const { p_org_id: orgId, p_team_id: teamId } = args;

      // BEGIN — the snapshot the rollback restores.
      const snapshot = {
        teams: db.teams.map((t) => ({ ...t })),
        memberships: db.memberships.map((m) => ({ ...m })),
      };

      const team = db.teams.find((t) => t.id === teamId);
      if (!orgId || !teamId || !team || team.organization_id !== orgId) {
        return { data: { found: false, detached: 0 }, error: null };
      }

      // Statement 1: detach, scoped to the verified org on both columns.
      let detached = 0;
      for (const m of db.memberships) {
        if (m.team_id === teamId && m.organization_id === orgId) {
          m.team_id = null;
          detached += 1;
        }
      }

      // Statement 2: delete.
      if (failDelete) {
        // ROLLBACK — the whole function raised, so statement 1 goes too.
        db.teams = snapshot.teams;
        db.memberships = snapshot.memberships;
        return { data: null, error: { message: "forced failure: the delete cannot proceed", code: "23503" } };
      }
      db.teams = db.teams.filter((t) => t.id !== teamId);

      // COMMIT.
      return { data: { found: true, detached }, error: null };
    },
  };

  return { db, svc, calls };
}

/** Drive DELETE with a verified caller and the fake database. */
async function del({ auth, id = TEAM, failDelete, rpcError } = {}) {
  getAuthedOrg.mockResolvedValue(auth === undefined ? actor("admin") : auth);
  const { db, svc, calls } = makeDb({ failDelete, rpcError });
  serviceClient.mockReturnValue(svc);

  const request = { headers: { get: () => null } };
  const res = await DELETE(request, { params: { id } });
  return { res, json: await res.json(), db, calls };
}

const attached = (db, teamId) => db.memberships.filter((m) => m.team_id === teamId).length;
const teamRows = (db, teamId) => db.teams.filter((t) => t.id === teamId).length;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the authorisation rule comes from permissions.js", () => {
  it("is exactly `can(\"manage_teams\")` — owner, admin, hr", () => {
    expect([...TEAM_MANAGERS].sort()).toEqual(["admin", "hr", "owner"]);
  });

  it("accepts a uuid and nothing else as a team id", () => {
    expect(isTeamId(TEAM)).toBe(true);
    expect(isTeamId("not-a-uuid")).toBe(false);
    expect(isTeamId("")).toBe(false);
    expect(isTeamId(null)).toBe(false);
    expect(isTeamId(undefined)).toBe(false);
  });
});

describe("authorizeTeamDelete — who may act at all", () => {
  it("refuses an unauthenticated caller", () => {
    expect(authorizeTeamDelete(null, TEAM)).toMatchObject({ ok: false, status: 401 });
  });

  it.each(["manager", "team_lead", "developer", "employee"])(
    "refuses a %s — supervising a team is not the same as dissolving one",
    (role) => {
      expect(authorizeTeamDelete(actor(role), TEAM)).toMatchObject({ ok: false, status: 403 });
    }
  );

  it("refuses a client by role", () => {
    expect(authorizeTeamDelete(actor("client"), TEAM)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a client by user_type even when the role claim says admin", () => {
    expect(authorizeTeamDelete(actor("admin", { userType: "client" }), TEAM)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it.each(["owner", "admin", "hr"])("allows a %s", (role) => {
    expect(authorizeTeamDelete(actor(role), TEAM)).toEqual({ ok: true });
  });

  it("answers a malformed id as 404, not 400 — same shape as 'not yours'", () => {
    expect(authorizeTeamDelete(actor("owner"), "../../etc/passwd")).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(authorizeTeamDelete(actor("owner"), null)).toMatchObject({ ok: false, status: 404 });
  });

  it("checks the caller BEFORE the id, so a non-privileged caller learns nothing", () => {
    expect(authorizeTeamDelete(actor("developer"), "garbage")).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("DELETE /api/admin/teams/[id] — an unauthorised caller is refused", () => {
  it("401s without a verified token, and touches nothing", async () => {
    getAuthedOrg.mockResolvedValue(null);
    const { svc, db, calls } = makeDb({});
    serviceClient.mockReturnValue(svc);
    const res = await DELETE({ headers: { get: () => null } }, { params: { id: TEAM } });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
    expect(teamRows(db, TEAM)).toBe(1);
    expect(attached(db, TEAM)).toBe(2);
  });

  it.each(["manager", "team_lead", "developer", "employee", "client"])(
    "403s a %s and never reaches the database",
    async (role) => {
      const { res, json, db, calls } = await del({ auth: actor(role) });
      expect(res.status).toBe(403);
      expect(json.error).toMatch(/forbidden/i);
      expect(calls).toEqual([]);
      expect(teamRows(db, TEAM)).toBe(1);
      expect(attached(db, TEAM)).toBe(2);
    }
  );
});

describe("DELETE /api/admin/teams/[id] — a team in another organization is 404", () => {
  it("404s for a team that belongs to another org", async () => {
    const { res, json, db } = await del({ auth: actor("owner"), id: FOREIGN_TEAM });
    expect(res.status).toBe(404);
    expect(json.error).toMatch(/not found/i);
    // Nothing over there moved.
    expect(teamRows(db, FOREIGN_TEAM)).toBe(1);
    expect(attached(db, FOREIGN_TEAM)).toBe(1);
  });

  it("gives a team that exists nowhere the SAME answer, so ids cannot be probed", async () => {
    const foreign = await del({ auth: actor("owner"), id: FOREIGN_TEAM });
    const absent = await del({ auth: actor("owner"), id: ABSENT_TEAM });
    const malformed = await del({ auth: actor("owner"), id: "not-a-uuid" });
    expect(absent.res.status).toBe(404);
    expect(malformed.res.status).toBe(404);
    expect(absent.json).toEqual(foreign.json);
    expect(malformed.json).toEqual(foreign.json);
  });

  it("takes the organization from the token and never from the request", async () => {
    const { calls } = await del({ auth: actor("owner"), id: TEAM });
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_org_id).toBe(ORG);
    // The only other argument is the id from the path — no org from a body.
    expect(Object.keys(calls[0].args).sort()).toEqual(["p_org_id", "p_team_id"]);
  });

  it("cannot be aimed at another org by an admin of this one", async () => {
    // Even an owner: the org handed to the function is theirs, so a foreign
    // team id simply is not found.
    const { res, db } = await del({ auth: actor("owner"), id: FOREIGN_TEAM });
    expect(res.status).toBe(404);
    expect(db.memberships.find((m) => m.id === "m4").team_id).toBe(FOREIGN_TEAM);
  });
});

describe("DELETE /api/admin/teams/[id] — on success BOTH effects are applied", () => {
  it("detaches every member AND removes the team", async () => {
    const { res, json, db } = await del({ auth: actor("admin"), id: TEAM });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, teamId: TEAM, detached: 2 });
    expect(teamRows(db, TEAM)).toBe(0);
    expect(attached(db, TEAM)).toBe(0);
  });

  it("keeps the members IN the organization — a detach, never a cascade", async () => {
    const { db } = await del({ auth: actor("admin"), id: TEAM });
    const acme = db.memberships.filter((m) => m.organization_id === ORG);
    expect(acme).toHaveLength(3);
    expect(acme.map((m) => m.email).sort()).toEqual(["a@acme.test", "b@acme.test", "c@acme.test"]);
    expect(acme.every((m) => m.team_id === null)).toBe(true);
  });

  it("leaves other organizations' rows alone", async () => {
    const { db } = await del({ auth: actor("admin"), id: TEAM });
    expect(teamRows(db, FOREIGN_TEAM)).toBe(1);
    expect(attached(db, FOREIGN_TEAM)).toBe(1);
  });

  it("reports the detached count the database returned", async () => {
    const { json } = await del({ auth: actor("hr"), id: TEAM });
    expect(json.detached).toBe(2);
  });
});

describe("DELETE /api/admin/teams/[id] — when the delete fails, NEITHER effect survives", () => {
  it("rolls the detach back with the delete", async () => {
    const { res, json, db } = await del({ auth: actor("owner"), id: TEAM, failDelete: true });
    expect(res.status).toBe(502);
    // The old two-round-trip version left 0 attached and the team present.
    expect(attached(db, TEAM)).toBe(2);
    expect(teamRows(db, TEAM)).toBe(1);
    expect(json.error).toMatch(/nothing was changed/i);
    expect(json.success).toBeUndefined();
  });

  it("says nothing was changed when the rpc itself errors", async () => {
    const { res, json, db } = await del({
      auth: actor("owner"),
      id: TEAM,
      rpcError: { message: "could not connect", code: "08006" },
    });
    expect(res.status).toBe(502);
    expect(json.error).toMatch(/nothing was changed/i);
    expect(attached(db, TEAM)).toBe(2);
    expect(teamRows(db, TEAM)).toBe(1);
  });

  it("never reports success on a null rpc result rather than assuming it worked", async () => {
    getAuthedOrg.mockResolvedValue(actor("owner"));
    serviceClient.mockReturnValue({ rpc: async () => ({ data: null, error: null }) });
    const res = await DELETE({ headers: { get: () => null } }, { params: { id: TEAM } });
    expect(res.status).toBe(404);
  });

  it("survives a params object delivered as a promise (Next 15)", async () => {
    getAuthedOrg.mockResolvedValue(actor("owner"));
    const { svc, db } = makeDb({});
    serviceClient.mockReturnValue(svc);
    const res = await DELETE(
      { headers: { get: () => null } },
      { params: Promise.resolve({ id: TEAM }) }
    );
    expect(res.status).toBe(200);
    expect(teamRows(db, TEAM)).toBe(0);
  });
});
