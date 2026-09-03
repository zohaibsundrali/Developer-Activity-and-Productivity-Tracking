import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLES } from "@/utils/roles";
import { PERMISSIONS, LEGACY_KEYS, permissionsForRole } from "@/utils/permissionCatalogue";
import { roleCan } from "@/utils/permissionEngine";
import { canAccessAdminSection } from "@/components/shell/sectionAccess";
import { SECTION_PERMISSIONS } from "@/components/shell/sectionAccess";

const root = path.resolve(__dirname, "..");
const read = (rel) =>
  readFileSync(path.join(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * The catalogue answers what the four things it replaced answered.
 *
 * This is a CHARACTERIZATION test, and it is the whole safety argument for the
 * change. Moving permission logic is the most dangerous refactor in the
 * product: get it wrong in the generous direction and somebody sees payroll;
 * get it wrong in the strict direction and an HR user cannot open the screen
 * they were hired to use. Neither shows up in a build.
 *
 * So nothing here checks that the new rules are GOOD. It checks that they are
 * the SAME. Twelve roles against every permission, compared with the answer the
 * old code gave. Improvements come after this passes, one at a time, each as
 * its own visible change — not smuggled in under a refactor.
 *
 * THE FIXTURES BELOW ARE DELIBERATE COPIES. Everywhere else in this codebase a
 * second copy of the rules is the bug being fixed. Here it is the point: these
 * are a frozen record of what the code said on the day it was replaced, and a
 * record that updates itself when the thing it records changes is not a record.
 * They were transcribed from:
 *
 *   src/utils/permissions.js               — the `can()` switch, 23 cases
 *   src/components/shell/sectionAccess.js  — ADMIN_SECTION_ROLES, 20 sections
 *   fifteen API routes                     — their hand-typed role arrays
 *
 * If a fixture and the catalogue disagree, the catalogue is wrong until proven
 * otherwise.
 */

// ── Frozen record: the bundles the old `can()` switch closed over ───────────
const OLD_ADMINS = ["owner", "admin"];
const OLD_PEOPLE_MANAGERS = ["owner", "admin", "hr"];
const OLD_SUPERVISORS = ["owner", "admin", "manager", "team_lead"];
const OLD_BILLING = ["owner", "admin", "finance"];
const OLD_REVIEWERS = ["owner", "admin", "manager", "team_lead", "qa"];

/** The old switch, transcribed case for case. */
function oldCan(role, action) {
  if (!role) return false;
  switch (action) {
    case "manage_org":
    case "manage_settings":
    case "delete_org":
      return role === "owner";
    case "manage_members":
    case "invite_members":
    case "create_developer":
    case "delete_developer":
    case "manage_employees":
    case "manage_teams":
    case "onboard_offboard":
    case "transfer_employee":
    case "activate_employee":
      return OLD_PEOPLE_MANAGERS.includes(role);
    case "create_project":
      return OLD_SUPERVISORS.includes(role);
    case "delete_project":
    case "manage_automation":
      return OLD_ADMINS.includes(role);
    case "review_tasks":
      return OLD_REVIEWERS.includes(role);
    case "manage_tasks":
    case "view_tracking":
    case "view_reports":
    case "view_team":
      return OLD_SUPERVISORS.includes(role);
    case "view_billing":
    case "manage_billing":
      return OLD_BILLING.includes(role);
    case "submit_task":
      return ["developer", "designer", "devops", "qa", "employee", "team_lead"].includes(role);
    default:
      // The old fail-OPEN default. Reproduced so the one intentional behaviour
      // change on this branch is visible as a disagreement rather than hidden.
      return true;
  }
}

/** Frozen record: ADMIN_SECTION_ROLES as it stood. `null` = everyone inside. */
const OLD_SECTION_ROLES = {
  overview: null,
  "all-projects": ["owner", "admin", "manager", "team_lead"],
  requests: ["owner", "admin", "manager", "team_lead"],
  "change-requests": ["owner", "admin", "manager", "team_lead"],
  "project-hub": ["owner", "admin", "manager", "team_lead"],
  board: ["owner", "admin"],
  views: ["owner", "admin", "manager", "team_lead"],
  sprints: ["owner", "admin", "manager", "team_lead"],
  "task-reviews": ["owner", "admin", "manager", "team_lead", "qa"],
  bugs: ["owner", "admin", "manager", "team_lead", "qa"],
  "developer-activity": ["owner", "admin"],
  reports: ["owner", "admin", "manager", "team_lead"],
  automation: ["owner", "admin"],
  employees: ["owner", "admin", "hr"],
  hierarchy: ["owner", "admin", "hr", "manager", "team_lead"],
  capacity: ["owner", "admin", "hr", "manager", "team_lead"],
  "team-stats": ["owner", "admin", "hr"],
  organization: ["owner", "admin", "hr"],
  clients: ["owner", "admin", "finance"],
  billing: ["owner", "admin", "finance"],
  "system-health": ["owner", "admin"],
  account: null,
};

/** Frozen record: the role arrays that lived inside individual API routes. */
const OLD_ROUTE_GUARDS = [
  { key: "task.review", roles: ["owner", "admin", "manager", "team_lead", "qa"], from: "api/admin-review REVIEWER_ROLES" },
  { key: "task.review", roles: ["owner", "admin", "manager", "team_lead", "qa"], from: "api/task-plan/review REVIEWER_ROLES" },
  { key: "project.assign_manager", roles: ["owner", "admin"], from: "api/projects/[id]/manager" },
  { key: "project.close", roles: ["owner", "admin"], from: "api/projects/[id]/closure" },
  { key: "project.view_all", roles: ["owner", "admin", "manager", "team_lead"], from: "api/developer-gantt STAFF_ROLES" },
  { key: "proposal.decide", roles: ["owner", "admin", "manager"], from: "api/proposals/[id]/decide DECIDER_ROLES" },
  { key: "change_request.create", roles: ["owner", "admin", "manager"], from: "api/change-requests STAFF_RAISERS" },
  { key: "change_request.decide", roles: ["owner", "admin", "manager"], from: "api/change-requests/[id]/advance STAFF_DECIDERS" },
  { key: "client.notify", roles: ["owner", "admin", "manager"], from: "api/notify/client STAFF_ROLES" },
  { key: "billing.manage", roles: ["owner", "admin", "finance"], from: "api/billing/demo-activate BILLING_ROLES" },
  { key: "billing.view", roles: ["owner", "admin", "finance"], from: "api/billing/subscription BILLING_ROLES" },
  { key: "member.invite", roles: ["owner", "admin", "hr", "manager"], from: "api/invitations INVITER_ROLES" },
  { key: "member.provision", roles: ["owner", "admin", "hr", "manager"], from: "api/auth/provision PROVISIONER_ROLES" },
  { key: "member.sync_roles", roles: ["owner", "admin"], from: "api/admin/members/sync-roles SYNC_ROLES" },
  { key: "system.health", roles: ["owner", "admin"], from: "api/admin/health HEALTH_ROLES" },
  { key: "system.audit", roles: ["owner", "admin"], from: "api/admin/legacy-auth-audit AUDIT_ROLES" },

  // ADDED AFTER A ROUTE-BY-ROUTE AUDIT of all 61 handlers. The first version of
  // this fixture was transcribed from the routes that happened to declare a
  // NAMED role array, and four guards written as inline comparisons were
  // missed. Every one of them would have been WIDENED by mapping it to the
  // nearest existing key — which is exactly the failure this file exists to
  // prevent, and it very nearly passed because the fixture was the thing that
  // was incomplete.
  { key: "billing.purchase", roles: ["owner"], from: "api/billing/checkout auth.role !== 'owner'" },
  { key: "billing.purchase", roles: ["owner"], from: "api/billing/cancel auth.role !== 'owner'" },
  { key: "billing.purchase", roles: ["owner"], from: "api/billing/portal auth.role !== 'owner'" },
  { key: "change_request.approve", roles: ["owner", "admin"], from: "api/change-requests/[id]/advance admin_approve" },
  { key: "member.delete", roles: ["owner", "admin"], from: "api/developer/delete" },
  { key: "project.complete", roles: ["owner", "admin", "manager", "team_lead"], from: "api/projects/[id]/closure mayManage" },
  { key: "project.assign_manager", roles: ["owner", "admin"], from: "api/projects/[id]/manager" },
  { key: "team.manage", roles: ["owner", "admin", "hr"], from: "api/admin/teams/[id] TEAM_MANAGERS" },
  { key: "member.manage", roles: ["owner", "admin", "hr"], from: "api/admin/members/role ROLE_CHANGERS" },
  { key: "signal.view", roles: ["owner", "admin", "hr", "manager", "team_lead"], from: "api/signals SIGNAL_ROLES" },
];

/**
 * Where the old sources CONTRADICTED each other, one of them had to win.
 *
 * Enumerated, never blanket. Each entry names the two disagreeing sources, says
 * which one is authoritative and why, and states what actually changes on
 * screen — so a divergence has to be argued for in writing before the parity
 * test will accept it. Anything not on this list must match exactly.
 */
const DELIBERATE_DIVERGENCES = [
  {
    legacy: "invite_members",
    key: "member.invite",
    // permissions.js `can()` filed this under PEOPLE_MANAGERS — owner, admin,
    // hr. /api/invitations has always used INVITER_ROLES — owner, admin, hr
    // AND manager. So the browser believed a project manager could not invite
    // anybody while the server accepted their invitations all along.
    //
    // The server wins. It is the gate that actually runs, it runs against a
    // verified JWT, and a manager inviting a developer onto their own project
    // is the behaviour the product ships today.
    //
    // Nothing on screen changes: `can("invite_members")` has no call sites —
    // grep says so — so this key was decided in two places and read in one.
    winner: "api/invitations INVITER_ROLES",
    roles: ["owner", "admin", "hr", "manager"],
  },
  {
    legacy: "view_tracking",
    key: "monitoring.view",
    // `can()` filed this under SUPERVISORS — owner, admin, manager, team_lead.
    // The Developer Activity section has always been owner/admin, and the RLS
    // policies on the monitoring tables (migration 040) admit the same two. So
    // a manager was told yes by a helper and no by the screen, the route and
    // the database.
    //
    // The screen wins, which is also the stricter direction. Screen captures
    // and keystroke counts of a named employee are the most sensitive thing
    // this product holds; where two sources disagree about who reads them, the
    // answer is the smaller list.
    //
    // Nothing on screen changes: `can("view_tracking")` has no call sites.
    winner: "sectionAccess developer-activity + migration 040 RLS",
    roles: ["owner", "admin"],
  },
  {
    legacy: "delete_developer",
    key: "member.delete",
    // The only divergence on this list that a user will SEE. `can()` said
    // owner/admin/hr and EmployeeDirectory.jsx:313 uses it to draw the Delete
    // control; /api/developer/delete has always been owner/admin. So an HR user
    // was shown a button that answered 403 every single time.
    //
    // The route wins, and it is also the safer direction: deleting a staff
    // account destroys their projects, tasks, submissions and activity logs and
    // cannot be undone.
    //
    // WHAT CHANGES ON SCREEN: HR stops seeing a Delete button. They lose no
    // capability, because they never had one — they lose a button that lied.
    winner: "api/developer/delete",
    roles: ["owner", "admin"],
  },
];

describe("the catalogue agrees with the can() switch it replaced", () => {
  it("answers identically for every role and every legacy action", () => {
    const diverged = new Map(DELIBERATE_DIVERGENCES.map((d) => [d.legacy, d]));
    for (const [legacy, key] of Object.entries(LEGACY_KEYS)) {
      for (const role of ROLES) {
        const divergence = diverged.get(legacy);
        const expected = divergence
          ? divergence.roles.includes(role)
          : oldCan(role, legacy);
        expect(roleCan(role, key), `${role} / ${legacy} -> ${key}`).toBe(expected);
      }
    }
  });

  it("keeps every divergence pointing at a real disagreement", () => {
    // A divergence that no longer disagrees with anything is a note nobody
    // will delete, and it silently exempts a key from the parity check.
    for (const d of DELIBERATE_DIVERGENCES) {
      const agrees = ROLES.every((r) => oldCan(r, d.legacy) === d.roles.includes(r));
      expect(agrees, `${d.legacy} no longer diverges — remove it`).toBe(false);
      expect(LEGACY_KEYS[d.legacy], d.legacy).toBe(d.key);
    }
  });

  it("covers every case the old switch had", () => {
    // A case left behind is a capability that silently lost its home. The old
    // switch had 23; each must map to exactly one key.
    const oldActions = [
      "manage_org", "manage_settings", "delete_org",
      "manage_members", "invite_members", "create_developer", "delete_developer",
      "manage_employees", "manage_teams", "onboard_offboard", "transfer_employee",
      "activate_employee", "create_project", "delete_project", "manage_automation",
      "review_tasks", "manage_tasks", "view_tracking", "view_reports", "view_team",
      "view_billing", "manage_billing", "submit_task",
    ];
    expect(oldActions).toHaveLength(23);
    for (const action of oldActions) {
      expect(LEGACY_KEYS, action).toHaveProperty(action);
    }
  });

  it("still refuses everyone when there is no role", () => {
    for (const key of PERMISSIONS.map((p) => p.key)) {
      expect(roleCan(null, key), key).toBe(false);
      expect(roleCan(undefined, key), key).toBe(false);
      expect(roleCan("", key), key).toBe(false);
    }
  });
});

describe("the catalogue agrees with the section table it replaced", () => {
  it("answers identically for every role and every section", () => {
    for (const [section, allowed] of Object.entries(OLD_SECTION_ROLES)) {
      for (const role of ROLES) {
        const before = allowed === null ? true : allowed.includes(role);
        expect(canAccessAdminSection(section, role), `${role} / ${section}`).toBe(before);
      }
    }
  });

  it("maps every gated section to a permission, and the open ones to none", () => {
    for (const [section, allowed] of Object.entries(OLD_SECTION_ROLES)) {
      if (allowed === null) {
        // `overview` and `account` are "everyone already inside the area".
        // Giving them a permission would be inventing a gate that never
        // existed and locking somebody out of their own account screen.
        expect(SECTION_PERMISSIONS[section] ?? null, section).toBeNull();
      } else {
        expect(SECTION_PERMISSIONS[section], section).toBeTruthy();
      }
    }
  });

  /**
   * Sections deliberately gated for the first time. Same rule as
   * DELIBERATE_DIVERGENCES: enumerated, argued for, never blanket.
   */
  const NEW_GATES = [
    {
      section: "productivity",
      key: "monitoring.view",
      // It has no sidebar entry — commented out of ADMIN_NAV — but it is still
      // a live `case` in the dashboard's section switch, so
      // `?section=productivity` rendered it. With no rule,
      // canAccessAdminSection fell through to "unknown ids stay open" and
      // answered true for all seven roles the admin area admits, hr and
      // finance included. Those two are kept off the monitoring surface on
      // purpose; monitoring.view is the rule the equivalent screen already has.
      //
      // Found by adversarial review of this branch, not by any test — which is
      // why the assertion below now runs in BOTH directions.
      reason: "reachable by URL with no rule at all; hr and finance could open it",
    },
    {
      section: "permissions",
      key: "permissions.manage",
      // A NEW SCREEN, so there is nothing to preserve — but it still has to be
      // declared here rather than slipping in, because this list is the record
      // of every section that gained a rule it did not have.
      //
      // Owner only, and the only section that is not open to admin. Whoever can
      // write a permission override can write themselves one, so this screen
      // hands out every other screen.
      reason: "new screen; owner-only because it grants every other permission",
    },
    // ── The own-work sections ─────────────────────────────────────────────
    //
    // NEW SCREENS IN THIS SHELL, and not a restriction on anybody: before them
    // the admin dashboard rendered no own-work screen at all, so there is no
    // access being taken away. They are listed here because this file is the
    // record of every section that gained a rule it did not have, and "it was
    // not gated before because it did not exist" still has to be written down.
    //
    // Keyed on the narrow `*_own` permissions rather than left `null`: unlike
    // somebody's own Account screen, logging time is a thing an organization
    // might want to take away from one person, and a `null` could not express
    // that. See NON_WIDENING_SECTIONS for why naming a permission here does not
    // widen who may enter the area.
    {
      section: "my-work",
      key: "task.view_own",
      reason: "new screen in the admin shell; qa/finance had no own-work surface",
    },
    {
      section: "timesheet",
      key: "timesheet.view_own",
      reason: "new screen in the admin shell; five roles could not log an hour",
    },
    {
      section: "projects",
      key: "project.view_own",
      reason: "new screen in the admin shell; distinct from all-projects",
    },
    // ── Attendance and leave (migration 075) ──────────────────────────────
    //
    // A NEW MODULE, so again nothing is being taken away: none of these three
    // screens existed under any rule before. `employee` is why the module was
    // built — ten permissions and a delivery-shaped dashboard, so a staff
    // member with no delivery role opened it and found nothing to do.
    {
      section: "my-attendance",
      key: "attendance.view_own",
      reason: "new module; every staff role has a working day",
    },
    {
      section: "my-leave",
      key: "leave.request_own",
      reason: "new module; every staff role takes leave",
    },
    {
      section: "leave-approvals",
      key: "leave.approve",
      reason: "new module; owner/admin/hr/manager, who are already in the area",
    },
    {
      section: "timesheet-approvals",
      key: "timesheet.approve",
      // A NEW SCREEN for a workflow that did not exist: hours were logged and
      // never agreed by anybody. owner/admin/manager/team_lead are all in the
      // area already, so it admits nobody new.
      reason: "new module; delivery oversight, all four roles already in the area",
    },
    {
      section: "invoicing",
      key: "invoice.view",
      // A NEW SCREEN. Client invoices existed as rows inside Client Management
      // with a hand-typed amount; nothing gated them as their own surface, and
      // owner/admin/finance are all in the area already.
      reason: "new screen; client invoicing and P&L, owner/admin/finance",
    },
    {
      section: "quality",
      key: "test_case.view",
      // A NEW SCREEN for something the product had no table for. 061 modelled a
      // bug as a developer_tasks row and explicitly did not build a test-case
      // manager; 081 does, without a second bug pipeline. REVIEWERS, all of
      // whom are in the area already.
      reason: "new module; test cases and runs, the reviewer roles",
    },
  ];

  it("does not gate a section nobody had a rule for", () => {
    // A section that appears in SECTION_PERMISSIONS but not in the frozen
    // record is a NEW restriction, and a refactor is not allowed to smuggle
    // one in. It has to be listed above with its argument.
    const declared = new Set(NEW_GATES.map((g) => g.section));
    for (const section of Object.keys(SECTION_PERMISSIONS)) {
      if (declared.has(section)) continue;
      expect(Object.keys(OLD_SECTION_ROLES), section).toContain(section);
    }
  });

  it("gates every new gate at the permission it claims", () => {
    for (const gate of NEW_GATES) {
      expect(SECTION_PERMISSIONS[gate.section], gate.section).toBe(gate.key);
      expect(Object.keys(OLD_SECTION_ROLES), gate.section).not.toContain(gate.section);
    }
  });

  it("has a rule for every section the dashboard can actually render", () => {
    /**
     * THE DIRECTION THAT WAS MISSING. The assertion above catches a section
     * gaining a rule it never had. Nothing caught a section that can be
     * RENDERED and has no rule — which is the one that hands a screen to
     * somebody, and is exactly how `productivity` stayed open.
     */
    const page = read("src/app/admin/dashboard/page.js");
    const cases = [...page.matchAll(/case\s+"([a-z-]+)":/g)].map((m) => m[1]);
    expect(cases.length, "found no cases — the regex has gone stale").toBeGreaterThan(15);
    for (const section of new Set(cases)) {
      expect(
        Object.prototype.hasOwnProperty.call(SECTION_PERMISSIONS, section),
        `?section=${section} renders and has no rule in SECTION_PERMISSIONS`
      ).toBe(true);
    }
  });
});

describe("the catalogue agrees with the guards hard-coded inside API routes", () => {
  it("answers identically for every role at every route guard", () => {
    for (const guard of OLD_ROUTE_GUARDS) {
      for (const role of ROLES) {
        expect(roleCan(role, guard.key), `${role} / ${guard.key} (${guard.from})`).toBe(
          guard.roles.includes(role)
        );
      }
    }
  });

  it("names a real permission at every guard", () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const guard of OLD_ROUTE_GUARDS) {
      expect(keys, guard.from).toContain(guard.key);
    }
  });
});

describe("the one behaviour that changes, stated out loud", () => {
  it("an unknown key used to be allowed for everyone and is now refused", () => {
    // `default: return true`. Every typo answered yes for anyone signed in.
    expect(oldCan("developer", "manage_setting")).toBe(true); // sic — the typo
    expect(roleCan("developer", "manage_setting")).toBe(false);
    expect(roleCan("owner", "not_a_permission")).toBe(false);
  });
});

describe("nobody is left holding nothing", () => {
  it("gives every staff role at least one permission", () => {
    // A role admitted to the product with an empty set has every screen
    // locked, which reads as a broken account rather than a restricted one.
    for (const role of ROLES) {
      if (role === "client") continue; // the portal has its own gate entirely
      expect(permissionsForRole(role).length, role).toBeGreaterThan(0);
    }
  });

  it("gives the owner everything except the things only a doer does", () => {
    // An owner who cannot reach something has nobody to ask, so the exceptions
    // have to be exceptions of KIND, not of authority. There is exactly one:
    // `task.submit` is filing your own work for someone else to review, and an
    // owner reviews rather than submits — which is what the old switch said
    // too, so this is a description of today, not a new rule.
    const missing = PERMISSIONS.map((p) => p.key).filter(
      (k) => !permissionsForRole("owner").includes(k)
    );
    expect(missing).toEqual(["task.submit"]);
  });
});
