import { getOrgContext } from "@/utils/orgContext";
import { ROLE_RANK as SHARED_ROLE_RANK } from "@/utils/roles";

/**
 * Lightweight role-based access control for the multi-tenant SaaS.
 *
 * ELEVEN ROLES, highest → lowest:
 *   owner, admin, manager, hr, finance, team_lead, qa, developer, designer,
 *   employee, client
 *
 * A ROLE IS NOT A JOB TITLE. Job titles live in
 * `employee_profiles.designation`, which is free text and can say anything —
 * "Scrum Master", "Solutions Architect", "Intern". A role exists only to say
 * what someone may DO, so two roles with identical permissions are one role
 * with two names, and every extra name is another list to keep in sync across
 * this file, navConfig.js, the API routes and the RLS policies.
 *
 * That is why the set stops here rather than mirroring an org chart:
 *
 *   finance   real difference — billing and invoices WITHOUT the monitoring
 *             surface. Before it existed an accountant had to be made `admin`
 *             to read an invoice, which also handed them every employee's
 *             screen captures.
 *   qa        real difference — a developer who may also review other people's
 *             submissions.
 *   designer  NO difference. Identical to `developer` today. It is here
 *             because designers were wanted as a first-class role rather than
 *             a job title, and because having the value in the enum is what
 *             lets the permissions diverge later without a data migration.
 *             Deliberate, not an oversight — see database/058.
 *
 * The DB `role_permissions` table holds a fine-grained matrix that NOTHING
 * currently reads; this helper is the real app-layer gate, and the RLS
 * policies are the real boundary.
 */
// Imported, not redeclared — see src/utils/roles.js for why there is only
// one copy of this now.
const ROLE_RANK = SHARED_ROLE_RANK;

// Capability groups.
const ADMINS = ["owner", "admin"];                       // org administration
const PEOPLE_MANAGERS = ["owner", "admin", "hr"];        // employee/people ops
const SUPERVISORS = ["owner", "admin", "manager", "team_lead"]; // task/team oversight
const BILLING = ["owner", "admin", "finance"];           // money, not monitoring
// Reviewers of submitted work. QA joins the supervisors here and ONLY here:
// reviewing is the job, but it does not come with the rest of the oversight
// surface (no reports, no tracking, no project administration).
const REVIEWERS = ["owner", "admin", "manager", "team_lead", "qa"];

export function getRole() {
  return getOrgContext()?.role || null;
}

export function hasRole(...roles) {
  const r = getRole();
  return r ? roles.includes(r) : false;
}

/**
 * Is the signed-in role at or above `role` in the ranking?
 *
 * Both unknown-value defaults are sentinels, NOT numbers on the same scale as
 * ROLE_RANK, and that is load-bearing. This used to read `|| 99` for the
 * target, which worked only because the highest real rank was 8 — widening the
 * scale to make room for `finance` and `qa` silently pushed `owner` to 100 and
 * turned `atLeast("superadmin")` from false into TRUE. A guard whose
 * correctness depends on a magic number staying larger than every other magic
 * number in the file is a guard that will break again the next time somebody
 * renumbers. Infinity and -Infinity cannot be overtaken.
 */
export function atLeast(role) {
  const r = getRole();
  if (!r) return false;
  const have = Object.prototype.hasOwnProperty.call(ROLE_RANK, r)
    ? ROLE_RANK[r]
    : Number.NEGATIVE_INFINITY; // unknown current role reaches nothing
  const need = Object.prototype.hasOwnProperty.call(ROLE_RANK, role)
    ? ROLE_RANK[role]
    : Number.POSITIVE_INFINITY; // unknown target is unreachable
  return have >= need;
}

/**
 * Coarse capability check. Keep in sync with the seeded role_permissions rows.
 */
export function can(action) {
  const r = getRole();
  if (!r) return false;
  switch (action) {
    // Owner-only: organization-level configuration + destructive org actions.
    // Every org always has an Owner (the signup creator), so these stay
    // reachable; a plain Admin gets view-only access to settings.
    case "manage_org":
    case "manage_settings":
    case "delete_org":
      return r === "owner";
    // People / employee operations — Owner, Admin, HR.
    case "manage_members":
    case "invite_members":
    case "create_developer":
    case "delete_developer":
    case "manage_employees":
    case "manage_teams":
    case "onboard_offboard":
    case "transfer_employee":
    case "activate_employee":
      return PEOPLE_MANAGERS.includes(r);
    // Creating a project is the project manager's job. It used to be
    // owner/admin only, which meant a PM could run a project but not start
    // one — every new piece of work had to queue behind a founder. Deleting
    // one stays owner/admin: starting work and destroying it are not the same
    // decision and should not carry the same permission.
    case "create_project":
      return SUPERVISORS.includes(r);
    // Project administration — Owner, Admin.
    case "delete_project":
    case "manage_automation":
      return ADMINS.includes(r);
    // Reviewing submitted work — the supervisors, plus QA. Split out from the
    // block below because reviewing is the whole point of the QA role, while
    // the rest of the oversight surface (tracking, reports, team) is not.
    case "review_tasks":
      return REVIEWERS.includes(r);
    // Task/team oversight — Owner, Admin, Manager, Team Lead.
    case "manage_tasks":
    case "view_tracking":
    case "view_reports":
    case "view_team":
      return SUPERVISORS.includes(r);
    // Money. Finance sees this and none of the monitoring above.
    case "view_billing":
    case "manage_billing":
      return BILLING.includes(r);
    // Who files work for review. Designer, DevOps and QA do the same kind of
    // work as a developer, so they submit it the same way — leaving them out
    // here was the sort of omission that looks like a permissions bug to the
    // person it happens to.
    case "submit_task":
      return ["developer", "designer", "devops", "qa", "employee", "team_lead"].includes(r);
    default:
      return true;
  }
}
