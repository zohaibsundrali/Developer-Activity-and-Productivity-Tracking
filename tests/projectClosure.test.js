import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Closing a project.
 *
 * THREE PEOPLE, THREE WORDS
 *   completed_at         the PM: the work is done
 *   client_signed_off_at the client: we agree
 *   closed_at            an admin: the file is shut
 *
 * The value is in what the route REFUSES, so that is what is driven here
 * rather than asserted about the source: the gate, and who may say which word.
 *
 * A NOTE ON THE MIGRATION UNDER IT. 063 shipped a real bug: the reopen branch
 * of its trigger cleared the client's sign-off and LEFT the rating behind,
 * producing exactly the row the trigger's own check forbids. The check does not
 * fire on the way out — it runs before the reopen branch on the same row — so
 * it fired on the NEXT update, any update, and a reopened project could not be
 * renamed, re-dated or closed again. Reproduced on postgres:16 and fixed in
 * 064; the assertions at the bottom pin the fix so it cannot be undone by a
 * later edit to that function.
 */

const root = path.resolve(__dirname, "..");
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

// ---------------------------------------------------------------------------
// A fake service client, shaped like the calls the route actually makes.
// ---------------------------------------------------------------------------

let state;

function resetState(overrides = {}) {
  state = {
    project: {
      id: "proj-1",
      organization_id: "org-1",
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
    },
    milestones: [{ status: "completed" }],
    openBugs: 0,
    clientLinked: true,
    updates: [],
    activity: [],
    ...overrides,
  };
  return state;
}

function thenable(result, extra = {}) {
  return { ...extra, then: (res, rej) => Promise.resolve(result).then(res, rej) };
}

function fakeClient() {
  return {
    from(table) {
      if (table === "projects") {
        const builder = {
          eq: () => builder,
          maybeSingle: async () => ({ data: state.project, error: null }),
          select: () => builder,
        };
        return {
          select: () => builder,
          update: (patch) => {
            state.updates.push(patch);
            // The trigger's behaviour that matters to the route: applying the
            // patch is what the next GET would see.
            Object.assign(state.project, patch);
            const u = {
              eq: () => u,
              select: () => u,
              maybeSingle: async () => ({ data: state.project, error: null }),
            };
            return u;
          },
        };
      }

      if (table === "milestones") {
        const b = { eq: () => b, then: (r) => r({ data: state.milestones, error: null }) };
        return { select: () => b };
      }

      if (table === "developer_tasks") {
        const b = {
          eq: () => b,
          neq: () => b,
          then: (r) => r({ count: state.openBugs, error: null }),
        };
        return { select: () => b };
      }

      if (table === "project_clients") {
        const b = {
          eq: () => b,
          maybeSingle: async () => ({
            data: state.clientLinked ? { project_id: "proj-1" } : null,
          }),
        };
        return { select: () => b };
      }

      if (table === "pm_activity") {
        return {
          insert: async (row) => {
            state.activity.push(row);
            return { error: null };
          },
        };
      }

      return { select: () => thenable({ data: [], error: null }) };
    },
  };
}

let auth;

vi.mock("@/utils/serverAuth", () => ({
  getAuthedOrg: async () => auth,
  serviceClient: () => fakeClient(),
}));

const { GET, POST } = await import("@/app/api/projects/[id]/closure/route.js");

const params = { id: "proj-1" };
const get = () => GET(new Request("https://verisade.test/x"), { params });
const post = (body) =>
  POST(
    new Request("https://verisade.test/x", { method: "POST", body: JSON.stringify(body) }),
    { params }
  );

const OWNER = { orgId: "org-1", role: "owner", userType: "admin", appUserId: "u-owner" };
const MANAGER = { orgId: "org-1", role: "manager", userType: "developer", appUserId: "u-pm" };
const DEVELOPER = { orgId: "org-1", role: "developer", userType: "developer", appUserId: "u-dev" };
const CLIENT = { orgId: "org-1", role: "client", userType: "client", appUserId: "c-1" };

beforeEach(() => {
  resetState();
  auth = OWNER;
});

// ---------------------------------------------------------------------------

describe("the gate on marking work complete", () => {
  it("allows it when every milestone is done and no bug is open", async () => {
    const res = await post({ action: "complete" });
    expect(res.status).toBe(200);
    expect(state.project.completed_at).toBeTruthy();
  });

  it("refuses while a milestone is open, and says how many", async () => {
    resetState({ milestones: [{ status: "completed" }, { status: "in_progress" }] });
    const res = await post({ action: "complete" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.detail).toContain("1 of 2 milestone");
    expect(state.project.completed_at).toBeNull();
  });

  it("refuses while a bug is open, and says how many", async () => {
    resetState({ openBugs: 3 });
    const body = await (await post({ action: "complete" })).json();
    expect(body.detail).toContain("3 bugs still open");
  });

  it("counts a REOPENED bug as open", async () => {
    // The route asks for `status != completed`, so `rejected` — a bug that
    // failed its retest — is counted. A gate that let those through would pass
    // a project with known broken work in it.
    const route = read("src/app/api/projects/[id]/closure/route.js");
    expect(route).toMatch(/\.neq\("status", "completed"\)/);
  });

  it("re-checks the gate at the button, not just at page load", async () => {
    // A bug filed between the page rendering and the click must still stop it.
    resetState({ openBugs: 0 });
    const ready = await (await get()).json();
    expect(ready.can.complete).toBe(true);

    state.openBugs = 1; // somebody files one
    expect((await post({ action: "complete" })).status).toBe(409);
  });

  it("reports the reasons through GET so the screen can explain itself", async () => {
    resetState({ milestones: [{ status: "pending" }], openBugs: 2 });
    const body = await (await get()).json();
    expect(body.gate.ready).toBe(false);
    expect(body.gate.reasons).toHaveLength(2);
    expect(body.can.complete).toBe(false);
  });
});

describe("who may say which word", () => {
  it("lets an owner mark complete", async () => {
    expect((await post({ action: "complete" })).status).toBe(200);
  });

  it("lets the project's own manager mark complete", async () => {
    state.project.manager_id = "u-pm";
    auth = MANAGER;
    expect((await post({ action: "complete" })).status).toBe(200);
  });

  it("refuses a manager who does not run this project", async () => {
    state.project.manager_id = "somebody-else";
    auth = MANAGER;
    expect((await post({ action: "complete" })).status).toBe(403);
  });

  it("allows a manager when the project has no manager at all", async () => {
    // manager_id is nullable and empty on most existing projects. Requiring it
    // would leave every one of those with nobody able to complete it.
    state.project.manager_id = null;
    auth = MANAGER;
    expect((await post({ action: "complete" })).status).toBe(200);
  });

  it("refuses a developer outright", async () => {
    auth = DEVELOPER;
    expect((await post({ action: "complete" })).status).toBe(403);
  });

  it("refuses STAFF signing off on the client's behalf", async () => {
    // The one claim in this flow that has to be the customer's own.
    state.project.completed_at = "2026-08-01T00:00:00Z";
    auth = OWNER;
    const res = await post({ action: "sign_off", rating: 5 });
    expect(res.status).toBe(403);
    expect(state.project.client_signed_off_at).toBeNull();
  });

  it("refuses a manager closing the project", async () => {
    state.project.completed_at = "2026-08-01T00:00:00Z";
    state.project.manager_id = "u-pm";
    auth = MANAGER;
    expect((await post({ action: "close" })).status).toBe(403);
  });

  it("refuses a client it cannot find on the project — as a 404, not a 403", async () => {
    // A client has no business learning that a project they are not on exists.
    resetState({ clientLinked: false });
    auth = CLIENT;
    expect((await get()).status).toBe(404);
    expect((await post({ action: "sign_off" })).status).toBe(404);
  });

  it("refuses everything for another organization's project", async () => {
    auth = { ...OWNER, orgId: "org-2" };
    // serviceClient bypasses RLS, so the org filter in the route IS the tenant
    // boundary. The fake honours the filter by returning the row regardless,
    // so this pins the filter's presence in the source instead.
    const route = read("src/app/api/projects/[id]/closure/route.js");
    expect(route.match(/\.eq\("organization_id", auth\.orgId\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the client's sign-off", () => {
  beforeEach(() => {
    state.project.completed_at = "2026-08-01T00:00:00Z";
    auth = CLIENT;
  });

  it("is refused before the team has marked the work complete", async () => {
    state.project.completed_at = null;
    expect((await post({ action: "sign_off", rating: 5 })).status).toBe(409);
  });

  it("writes the sign-off and the rating in ONE update", async () => {
    // Split across two writes, the rating would arrive at a row whose sign-off
    // was still null, and the trigger would refuse it.
    await post({ action: "sign_off", rating: 4, feedback: " good work " });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].client_signed_off_at).toBeTruthy();
    expect(state.updates[0].client_rating).toBe(4);
    expect(state.updates[0].client_feedback).toBe("good work");
  });

  it("accepts a sign-off with no rating", async () => {
    const res = await post({ action: "sign_off" });
    expect(res.status).toBe(200);
    expect(state.project.client_rating).toBeNull();
  });

  it("refuses a rating outside 1-5, and a fractional one", async () => {
    for (const bad of [0, 6, -1, 2.5, "five"]) {
      const res = await post({ action: "sign_off", rating: bad });
      expect(res.status, `rating ${bad}`).toBe(400);
    }
    expect(state.project.client_signed_off_at).toBeNull();
  });

  it("cannot be given twice", async () => {
    await post({ action: "sign_off", rating: 5 });
    expect((await post({ action: "sign_off", rating: 1 })).status).toBe(409);
  });
});

describe("closing and reopening", () => {
  it("refuses to close work that was never marked complete", async () => {
    expect((await post({ action: "close" })).status).toBe(409);
  });

  it("closes WITHOUT the client's sign-off, and records that it was unsigned", async () => {
    // Clients go quiet. A finished, paid-for project should not stay open
    // forever waiting for a reply — but the record says it was closed unsigned.
    state.project.completed_at = "2026-08-01T00:00:00Z";
    expect((await post({ action: "close", note: "Paid in full." })).status).toBe(200);
    expect(state.project.closed_at).toBeTruthy();
    expect(state.project.closure_note).toBe("Paid in full.");
    const logged = state.activity.find((a) => a.action === "project_closed");
    expect(logged.meta.signedOff).toBe(false);
  });

  it("records the rating BEFORE reopening throws it away", async () => {
    // After the update, pm_activity is the only place that number still exists.
    state.project.completed_at = "2026-08-01T00:00:00Z";
    state.project.client_signed_off_at = "2026-08-02T00:00:00Z";
    state.project.client_rating = 5;
    state.project.client_feedback = "great";
    state.project.closed_at = "2026-08-03T00:00:00Z";

    await post({ action: "reopen" });

    const logged = state.activity.find((a) => a.action === "project_reopened");
    expect(logged.meta.clearedRating).toBe(5);
    expect(logged.meta.clearedFeedback).toBe("great");
    expect(state.project.closed_at).toBeNull();
  });

  it("refuses to reopen a project that is not closed", async () => {
    expect((await post({ action: "reopen" })).status).toBe(409);
  });

  it("refuses an action it does not know", async () => {
    expect((await post({ action: "delete_everything" })).status).toBe(400);
  });

  it("refuses an unauthenticated caller", async () => {
    auth = null;
    expect((await get()).status).toBe(401);
    expect((await post({ action: "complete" })).status).toBe(401);
  });
});

describe("064 — the reopen bug in 063", () => {
  const M = read("database/064_reopen_clears_the_rating.sql");

  it("clears the rating and the feedback in the reopen branch", () => {
    // Without these two, a reopened row holds a rating with no sign-off — the
    // state the check above it forbids — and every later update fails on a
    // field nobody touched.
    expect(M).toMatch(/new\.client_rating := null/);
    expect(M).toMatch(/new\.client_feedback := null/);
  });

  it("keeps both rules 063 set", () => {
    expect(M).toMatch(/Mark the work complete before closing the project/);
    expect(M).toMatch(/only exists once the client has signed off/);
    expect(M).toMatch(/new\.client_signed_off_at := null/);
    expect(M).toMatch(/new\.completed_at := null/);
  });

  it("repairs rows already stuck, and does it AFTER replacing the function", () => {
    // The repair fires the same trigger. Under the old function it would be
    // refused by the very check it is repairing.
    const fnAt = M.indexOf("create or replace function public.tg_project_closure_guard");
    const repairAt = M.indexOf("update public.projects");
    expect(fnAt).toBeGreaterThan(-1);
    expect(repairAt).toBeGreaterThan(fnAt);
  });

  it("verifies the running function, not a comment claiming it was fixed", () => {
    expect(M).toMatch(/pg_get_functiondef\(oid\) like '%new\.client_rating := null%'/);
  });
});
