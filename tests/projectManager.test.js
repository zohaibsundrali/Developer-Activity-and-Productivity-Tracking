import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Assigning a project manager.
 *
 * WHAT WAS WRONG — found while writing a manual test script, which asked the
 * user to "edit the project and set the manager". There was no such control.
 *
 * `projects.manager_id` was written in exactly ONE place: accepting a client
 * proposal. So a project created from All Projects, cloned from a template or
 * imported could NEVER have a manager, and a project whose manager left could
 * never get a new one. The consequences were not cosmetic:
 *
 *   - Team Structure's "Without a manager" section — the one that exists to be
 *     acted on — was permanently stuck for those projects.
 *   - The closure gate reads manager_id to decide who may mark work complete.
 *     With it permanently null that check falls back to "any manager or team
 *     lead", looser than intended and impossible to tighten.
 *
 * THE COLUMN CARRIES AUTHORITY, which is why this is a route and not a browser
 * write: mayManage() grants the named manager the right to complete a project,
 * so anyone able to write it could grant themselves that right.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

let state;
const resetState = () => {
  state = {
    project: { id: "p1", name: "Testing", manager_id: null },
    members: {
      pm: { user_id: "pm", role: "manager", status: "active", email: "pm@x.com", user_type: "developer" },
      dev: { user_id: "dev", role: "developer", status: "active", email: "d@x.com", user_type: "developer" },
      gone: { user_id: "gone", role: "manager", status: "suspended", email: "g@x.com", user_type: "developer" },
    },
    updates: [],
    activity: [],
  };
};

function fakeClient() {
  return {
    from(table) {
      if (table === "projects") {
        const b = {
          eq: () => b,
          // A COPY, like the network returns. Handing out the live object let a
          // later .update() mutate the row the route was still holding, so the
          // "previous manager" it logged had already been overwritten — a bug
          // in this fake, not in the route.
          maybeSingle: async () => ({ data: { ...state.project }, error: null }),
        };
        return {
          select: () => b,
          update: (patch) => {
            state.updates.push(patch);
            Object.assign(state.project, patch);
            const u = { eq: () => u, then: (r) => r({ error: null }) };
            return u;
          },
        };
      }
      if (table === "memberships") {
        // Honours the filters the ROUTE applies rather than enforcing the rule
        // itself. The first version hard-coded `status === "active"` in here,
        // so the "refuses a suspended member" test passed even when the route
        // dropped that filter entirely — the test was checking the fake.
        const filters = {};
        const b = {
          eq: (col, val) => {
            filters[col] = val;
            return b;
          },
          maybeSingle: async () => {
            const m = state.members[filters.user_id];
            if (!m) return { data: null };
            for (const [col, val] of Object.entries(filters)) {
              if (col === "organization_id") continue; // supplied by the route's auth
              if (String(m[col] ?? "") !== String(val)) return { data: null };
            }
            return { data: m };
          },
        };
        return { select: () => b };
      }
      if (table === "pm_activity") {
        return { insert: async (row) => (state.activity.push(row), { error: null }) };
      }
      return { select: () => ({ then: (r) => r({ data: [], error: null }) }) };
    },
  };
}

let auth;
vi.mock("@/utils/serverAuth", () => ({
  getAuthedOrg: async () => auth,
  serviceClient: () => fakeClient(),
}));
vi.mock("@/utils/notifications", () => ({ notify: async () => ({ error: null }) }));

const { POST } = await import("@/app/api/projects/[id]/manager/route.js");

const params = { id: "p1" };
const post = (body) =>
  POST(new Request("https://x.test/x", { method: "POST", body: JSON.stringify(body) }), { params });

const OWNER = { orgId: "o1", role: "owner", userType: "admin", appUserId: "u-owner" };
const ADMIN = { orgId: "o1", role: "admin", userType: "admin", appUserId: "u-admin" };
const MANAGER = { orgId: "o1", role: "manager", userType: "developer", appUserId: "pm" };
const CLIENT = { orgId: "o1", role: "client", userType: "client", appUserId: "c1" };

beforeEach(() => {
  resetState();
  auth = OWNER;
});

describe("who may change it", () => {
  it("lets an owner and an admin", async () => {
    expect((await post({ managerId: "pm" })).status).toBe(200);
    resetState();
    auth = ADMIN;
    expect((await post({ managerId: "pm" })).status).toBe(200);
  });

  it("refuses a MANAGER — they could hand themselves every project", async () => {
    auth = MANAGER;
    expect((await post({ managerId: "pm" })).status).toBe(403);
    expect(state.project.manager_id).toBeNull();
  });

  it("refuses a client and an unauthenticated caller", async () => {
    auth = CLIENT;
    expect((await post({ managerId: "pm" })).status).toBe(403);
    auth = null;
    expect((await post({ managerId: "pm" })).status).toBe(401);
  });
});

describe("who may BE the manager", () => {
  it("accepts a manager", async () => {
    expect((await post({ managerId: "pm" })).status).toBe(200);
    expect(state.project.manager_id).toBe("pm");
  });

  it("refuses a developer — the role cannot run a project", async () => {
    const res = await post({ managerId: "dev" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be a project manager/);
    expect(state.project.manager_id).toBeNull();
  });

  it("refuses a suspended member", async () => {
    // Assigning a project to a locked-out account leaves it unmanaged while
    // looking managed — worse than leaving it blank.
    expect((await post({ managerId: "gone" })).status).toBe(400);
  });

  it("refuses a uuid belonging to nobody", async () => {
    // Without this the field is free text that silently assigns to nobody.
    expect((await post({ managerId: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
  });

  it("accepts the same eligible roles the proposal route does", () => {
    // A manager assigned at acceptance and one assigned later must mean the
    // same thing.
    const decide = read("src/app/api/proposals/[id]/decide/route.js");
    const route = read("src/app/api/projects/[id]/manager/route.js");
    const list = /\["owner", "admin", "manager", "team_lead"\]/;
    expect(decide).toMatch(list);
    expect(route).toMatch(list);
  });
});

describe("clearing it", () => {
  it("accepts null as a real instruction", async () => {
    state.project.manager_id = "pm";
    const res = await post({ managerId: null });
    expect(res.status).toBe(200);
    expect(state.project.manager_id).toBeNull();
  });

  it("records the clear distinctly from an assignment", async () => {
    state.project.manager_id = "pm";
    await post({ managerId: null });
    expect(state.activity.at(-1).action).toBe("project_manager_cleared");
  });

  it("keeps the previous manager in the trail", async () => {
    state.project.manager_id = "pm";
    await post({ managerId: null });
    expect(state.activity.at(-1).meta.previousManagerId).toBe("pm");
  });
});

describe("saying yes to what is already true", () => {
  it("is not an error, and writes nothing", async () => {
    // A double-click must not look broken.
    state.project.manager_id = "pm";
    const res = await post({ managerId: "pm" });
    expect(res.status).toBe(200);
    expect((await res.json()).unchanged).toBe(true);
    expect(state.updates).toHaveLength(0);
  });
});

describe("the screen", () => {
  const UI = read("src/components/admin/ProjectOverview.jsx");

  it("fetches manager_id, or the dropdown could never show the current value", () => {
    expect(UI).toMatch(/select\("id, name, status, progress, deadline, end_date, start_date, is_template, archived, manager_id"\)/);
  });

  it("offers only eligible, active people", () => {
    expect(UI).toMatch(/e\.status === "active"/);
    expect(UI).toMatch(/\["owner", "admin", "manager", "team_lead"\]\.includes\(e\.role\)/);
  });

  it("gates the control on owner/admin and SAYS so rather than hiding it", () => {
    // A control that is simply absent reads as a missing feature.
    expect(UI).toMatch(/hasRole\("owner", "admin"\)/);
    expect(UI).toMatch(/Only an owner or admin can change this/);
  });

  it("inspects the response — authFetch resolves on a 4xx", () => {
    // Otherwise a 403 renders as a successful save.
    expect(UI).toMatch(/if \(!res\.ok\) \{[\s\S]{0,160}showError/);
  });

  it("re-reads the project rather than patching local state", () => {
    // The row is the truth, and the closure panel reads manager_id too.
    expect(UI).toMatch(/await loadProjects\(projectId\)/);
  });
});
