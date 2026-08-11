import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The client → proposal → accept → assign flow.
 *
 * The interesting failures here are not "the form does not submit" — they are
 * the half-states: a project that exists but the client cannot see, a decision
 * with no reason, a proposal that says accepted with nothing behind it. Those
 * are what these assertions pin.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

const MIGRATION = read("database/059_project_proposals.sql");
const LIST = read("src/app/api/proposals/route.js");
const DECIDE = read("src/app/api/proposals/[id]/decide/route.js");
const NAV = read("src/components/shell/navConfig.js");

describe("the migration guards the states nobody should be able to reach", () => {
  it("refuses a rejection or a needs_info with no reason", () => {
    expect(MIGRATION).toMatch(/needs a reason/i);
    expect(MIGRATION).toMatch(/in \('rejected','needs_info'\)/);
  });

  it("refuses an accepted proposal with no project behind it", () => {
    expect(MIGRATION).toMatch(/must reference its project/i);
  });

  it("refuses un-accepting", () => {
    expect(MIGRATION).toMatch(/cannot be un-accepted/i);
  });

  it("states its grants instead of inheriting them", () => {
    // Without these every policy is correct and every query still fails with
    // "permission denied" — and it would have worked on Supabase while failing
    // on a fresh database.
    expect(MIGRATION).toMatch(/grant select, insert, update on public\.project_proposals to authenticated/);
    expect(MIGRATION).toMatch(/revoke all on public\.project_proposals from anon/);
  });

  it("lets a client insert only as itself, and only as 'submitted'", () => {
    const m = MIGRATION.match(/create policy proposals_client_insert[\s\S]*?;/);
    expect(m?.[0]).toContain("client_id = public.auth_app_user_id()");
    expect(m?.[0]).toContain("status = 'submitted'");
  });

  it("gives the client NO update policy at all", () => {
    // Editing after submission would mean the proposal an admin read and the
    // one they accepted could differ, with no record of the change.
    expect(MIGRATION).not.toMatch(/create policy proposals_client_update/);
  });

  it("keeps deciding to owner/admin/manager — not team_lead", () => {
    const m = MIGRATION.match(/create policy proposals_staff_decide[\s\S]*?;/);
    expect(m?.[0]).toContain("'owner','admin','manager'");
    expect(m?.[0]).not.toContain("team_lead");
  });
});

describe("the list route re-applies the client scope the service key bypasses", () => {
  it("filters a client to its own rows", () => {
    // serviceClient() ignores RLS, so a route that forgets this leaks the
    // whole organization to every client.
    expect(LIST).toMatch(/if \(!isStaff\(auth\)\) q = q\.eq\("client_id", auth\.appUserId\)/);
  });

  it("takes the organization from the token, never the body", () => {
    expect(LIST).toContain('eq("organization_id", auth.orgId)');
    expect(LIST).not.toMatch(/body\.organization/i);
  });

  it("refuses staff filing a proposal 'on the client's behalf'", () => {
    expect(LIST).toMatch(/Only a client can submit/);
  });

  it("refuses a second open proposal from the same client", () => {
    expect(LIST).toContain("proposal_pending");
    expect(LIST).toMatch(/\.in\("status", \["submitted", "in_review"\]\)/);
  });

  it("stores a budget only when it is really a number", () => {
    expect(LIST).toMatch(/Number\.isFinite\(n\)/);
  });
});

describe("accept is ordered so a failure cannot claim success", () => {
  it("creates the project, links the client, THEN marks accepted", () => {
    const proj = DECIDE.indexOf('.from("projects")');
    const link = DECIDE.indexOf('.from("project_clients")');
    const mark = DECIDE.indexOf('status: "accepted"');
    expect(proj).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(proj);
    expect(mark).toBeGreaterThan(link);
  });

  it("removes the project again if the client link fails", () => {
    // A project the client cannot see is worse than no project, because
    // everyone believes it is visible.
    const idx = DECIDE.indexOf("if (linkErr)");
    const near = DECIDE.slice(idx, idx + 200);
    expect(near).toContain('.from("projects")');
    expect(near).toContain(".delete()");
  });

  it("undoes both if the proposal will not move", () => {
    const idx = DECIDE.indexOf("if (updErr)");
    const near = DECIDE.slice(idx, idx + 300);
    expect(near).toContain('.from("project_clients")');
    expect(near).toContain('.from("projects")');
  });

  it("will not accept a proposal twice", () => {
    expect(DECIDE).toContain('.neq("status", "accepted")');
  });

  it("checks the billing lock before creating a project", () => {
    // Otherwise accepting is a side door around the check every other create
    // goes through.
    const lock = DECIDE.indexOf("requireUnlocked");
    const proj = DECIDE.indexOf('.from("projects")');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(proj);
  });

  it("verifies the assigned manager is really one, in this organization", () => {
    const idx = DECIDE.indexOf("if (managerId)");
    const near = DECIDE.slice(idx, idx + 600);
    expect(near).toContain('.from("memberships")');
    expect(near).toContain('eq("organization_id", auth.orgId)');
    expect(near).toMatch(/"manager"/);
  });

  it("keeps deciding to owner/admin/manager", () => {
    expect(DECIDE).toMatch(/DECIDER_ROLES = \["owner", "admin", "manager"\]/);
  });

  it("never lets a failed notification undo a recorded decision", () => {
    // Both notify helpers swallow their own errors.
    const helpers = DECIDE.match(/async function notify\w+[\s\S]*?\n}/g) || [];
    expect(helpers.length).toBe(2);
    for (const h of helpers) expect(h).toContain("catch");
  });
});

describe("the screens are reachable by the right roles", () => {
  it("puts Requests in the admin sidebar for the deciders and team_lead", () => {
    const m = NAV.match(/requests:\s*\[([^\]]*)\]/);
    for (const role of ["owner", "admin", "manager", "team_lead"]) {
      expect(m?.[1], role).toContain(role);
    }
  });

  it("gives the client a New Project entry", () => {
    expect(NAV).toMatch(/id: "new-project"/);
  });

  it("names both sections, so the topbar and the heading agree", () => {
    const titles = read("src/components/shell/sectionTitles.js");
    expect(titles).toMatch(/requests:\s*\{ admin: "Requests" \}/);
    expect(titles).toMatch(/"new-project":\s*\{ client: "New Project" \}/);
  });
});

describe("notifications use real categories", () => {
  it("does not invent category names", () => {
    // An invented category still inserts (there is no CHECK) and then falls
    // through to "general" in the bell, losing its icon and its filter.
    const valid = ["assignment", "status", "mention", "comment", "deadline",
                   "review", "sprint", "project", "team", "automation",
                   "signal", "general"];
    for (const src of [LIST, DECIDE]) {
      for (const m of src.matchAll(/category:\s*"([^"]+)"/g)) {
        expect(valid, `unknown category ${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe("client accounts can be created and then self-managed", () => {
  const CREATE = read("src/components/admin/CreateClientAccount.jsx");
  const ACCOUNT_ROUTE = read("src/app/api/client/account/route.js");
  const FORMS = read("src/components/client/ClientAccountForms.jsx");

  it("never writes the legacy plaintext password column", () => {
    // `clients.password` exists and is legacy. The credential belongs to
    // Supabase Auth, which stores it hashed.
    const insert = CREATE.match(/\.from\("clients"\)\s*\.insert\(\{[\s\S]*?\}\)/);
    expect(insert?.[0]).not.toMatch(/\bpassword\b/);
  });

  it("rolls the profile row back when the login cannot be created", () => {
    // A client profile that can never sign in is worse than no row: it appears
    // in every picker, can be linked to a project, and silently receives
    // nothing.
    expect(CREATE).toMatch(/\.from\("clients"\)\.delete\(\)\.eq\("id", createdId\)/);
  });

  it("provisions with the client role and user type", () => {
    expect(CREATE).toMatch(/role: "client"/);
    expect(CREATE).toMatch(/userType: "client"/);
  });

  it("uses new-password autocomplete for a credential being set for someone else", () => {
    expect(CREATE).toMatch(/autoComplete="new-password"/);
  });

  it("the self-service route whitelists the columns a client may change", () => {
    expect(ACCOUNT_ROUTE).toMatch(/EDITABLE = \["name", "phone", "company"\]/);
    // Anything that would let a client move organization or change its own
    // status must not be reachable.
    for (const forbidden of ["organization_id", "status", "auth_user_id", "email"]) {
      const m = ACCOUNT_ROUTE.match(/EDITABLE = \[([^\]]*)\]/);
      expect(m?.[1], forbidden).not.toContain(forbidden);
    }
  });

  it("scopes the update to the caller from the TOKEN, not the body", () => {
    expect(ACCOUNT_ROUTE).toContain('eq("id", auth.appUserId)');
    expect(ACCOUNT_ROUTE).toContain('eq("organization_id", auth.orgId)');
  });

  it("refuses staff on the client self-service route", () => {
    expect(ACCOUNT_ROUTE).toMatch(/auth\.userType !== "client"/);
  });

  it("requires the CURRENT password before changing it", () => {
    // Supabase would let a live session set a new password without it — one
    // unattended laptop away from someone locking the owner out.
    expect(FORMS).toContain("signInWithPassword");
    const idx = FORMS.indexOf("signInWithPassword");
    const upd = FORMS.indexOf("updateUser");
    expect(idx).toBeLessThan(upd);
  });

  it("sends the new password to Supabase Auth, not to our server", () => {
    expect(FORMS).toContain("supabase.auth.updateUser");
    expect(FORMS).not.toMatch(/authFetch\([^)]*password/);
  });
});
