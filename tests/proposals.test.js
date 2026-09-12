import { describe, it, expect } from "vitest";
import { roleCan } from "@/utils/permissionEngine";
import { ROLES } from "@/utils/roles";
import { canAccessAdminSection } from "@/components/shell/sectionAccess";
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
const ATOMIC = read("supabase/migrations/20260911163440_production_atomic_proposal_decisions.sql");
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

describe("acceptance is one database transaction", () => {
  it("uses the locked service transaction with no compensating browser writes", () => {
    expect(DECIDE).toContain("svc.rpc('decide_project_proposal'");
    expect(DECIDE).not.toContain('.delete()');
    expect(ATOMIC).toContain('for update');
    expect(ATOMIC.indexOf('insert into public.projects')).toBeLessThan(ATOMIC.indexOf('insert into public.project_clients'));
    expect(ATOMIC).toContain("p.status in ('accepted','rejected')");
    expect(ATOMIC).toContain("'replayed',true");
  });
  it("checks billing, typed manager identity and current effective capabilities", () => {
    expect(ATOMIC).toContain('app_private.org_unlocked(p_org)');
    expect(ATOMIC).toContain("user_type=manager_type and status='active'");
    expect(ATOMIC).toContain("permission_key='proposal.decide'");
    expect(DECIDE).toContain("requirePermission(auth, 'proposal.decide')");
    for (const role of ROLES) expect(roleCan(role,'proposal.decide')).toBe(['owner','admin','manager'].includes(role));
  });
  it("records durable client delivery intent inside the decision and reports later delivery failure", () => {
    expect(ATOMIC).toContain('insert into public.proposal_decision_emails');
    expect(DECIDE).toContain('flushProposalDecisionEmails(svc, proposalId)');
    expect(DECIDE).toContain('Client email is queued for retry');
    expect(DECIDE).not.toContain('actor_id: proposal.client_id');
  });
});

describe("the screens are reachable by the right roles", () => {
  it("puts Requests in the admin sidebar for the deciders and team_lead", () => {
    // The rule itself, not a regex over whichever file currently holds it.
    for (const role of ["owner", "admin", "manager", "team_lead"]) {
      expect(canAccessAdminSection("requests", role), role).toBe(true);
    }
    for (const role of ["developer", "designer", "qa", "hr"]) {
      expect(canAccessAdminSection("requests", role), role).toBe(false);
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

  it("preserves the profile after uncertain login creation and retries its identity", () => {
    // Auth may have committed even when the HTTP response was lost. Removing
    // its profile would detach a working credential and make retries orphan it.
    expect(CREATE).not.toMatch(/\.from\("clients"\)\.delete\(\)/);
    expect(CREATE).toContain('let client = found.data?.[0]');
    expect(CREATE).toContain('appUserId: client.id');
    expect(CREATE).toContain('The profile is saved');
    expect(CREATE).toContain('!completed?.success || !completed.userId');
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

describe("the company's own numbers, not the client's hopes", () => {
  const MIGRATION = read("database/062_proposal_estimates.sql");
  const DECIDE = read("src/app/api/proposals/[id]/decide/route.js");
  const LIST = read("src/app/api/proposals/route.js");
  const UI = read("src/components/admin/ProjectRequests.jsx");

  it("keeps the client's figures AND adds ours", () => {
    // The gap between what they asked for and what it costs IS the
    // conversation; collapsing them into one column loses it.
    expect(MIGRATION).toContain("estimated_cost");
    expect(MIGRATION).toContain("estimated_hours");
    expect(MIGRATION).toContain("estimated_timeline_days");
    expect(MIGRATION).toMatch(/column_name in \('budget','currency','desired_deadline'\)/);
  });

  it("makes every new column nullable", () => {
    // A proposal exists before anyone has costed it; requiring these would
    // refuse the client's submission.
    expect(MIGRATION).not.toMatch(/add column if not exists \w+ \w+ not null/i);
  });

  it("changes no policy", () => {
    expect(MIGRATION).not.toMatch(/create policy|drop policy/i);
  });

  it("honours zero estimates and counts the deadline from UTC acceptance", () => {
    expect(ATOMIC).toContain('coalesce(p.estimated_cost,p.budget)');
    expect(ATOMIC).toContain("(now() at time zone 'UTC')::date+p.estimated_timeline_days");
    expect(ATOMIC).toContain('else p.desired_deadline end');
  });
  it("validates estimates and keeps costing internal", () => {
    expect(DECIDE).toContain('function numberOrNull(');
    expect(DECIDE).toContain('cost === null && hours === null');
    expect(ATOMIC).toContain("if p_decision='estimate' then");
    expect(ATOMIC).toContain("if p_decision in ('accepted','rejected','needs_info') then");
    expect(DECIDE).toContain("['accepted', 'rejected', 'needs_info'].includes(decision)");
  });

  it("strips internal_notes from what a client receives", () => {
    expect(LIST).toMatch(/const \{ internal_notes, \.\.\.rest \} = row/);
    expect(LIST).toMatch(/isStaff\(auth\) \? data \|\| \[\] : \(data \|\| \[\]\)\.map\(CLIENT_SAFE\)/);
  });

  it("shows the asker's figure beside the estimate box", () => {
    // Somebody pricing the work should see what was hoped for without leaving
    // the field they are typing into.
    expect(UI).toMatch(/They asked for/);
  });

  it("says on the button that acceptance follows the estimate", () => {
    expect(UI).toMatch(/Accept on your estimate/);
  });
});
