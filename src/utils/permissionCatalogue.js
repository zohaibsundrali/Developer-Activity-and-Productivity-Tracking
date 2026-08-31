/**
 * THE permission registry. One list, every capability the product has.
 *
 * WHY THIS EXISTS
 *
 * Permission logic was written down in four unrelated places, and none of them
 * knew about the others:
 *
 *   1. `can()` in utils/permissions.js — a 23-case switch
 *   2. `ADMIN_SECTION_ROLES` in components/shell/sectionAccess.js — 20 sections
 *   3. fifteen hand-typed arrays inside individual API routes, named
 *      REVIEWER_ROLES, SUPERVISORS, BILLING_ROLES, INVITER_ROLES, DECIDER_ROLES,
 *      STAFF_RAISERS, PROVISIONER_ROLES, AUDIT_ROLES, SYNC_ROLES, HEALTH_ROLES…
 *   4. `role_permissions` in the database — 39 rows that NOTHING reads
 *
 * Four copies of one idea drift, and they had. Two examples, both live before
 * this file existed and both fixed by it:
 *
 *   - The invite form offered `finance`, `qa` and `designer`. The invitations
 *     route's own ASSIGNABLE_ROLES list did not have them, so choosing any of
 *     the three answered `400 Invalid role.` — a role the product had shipped
 *     two migrations ago, refused by the one screen that hands it out.
 *   - `devops` (migration 067) never reached the invite dropdown at all,
 *     because that dropdown held a fifth hand-typed copy of the role list.
 *
 * Neither failed loudly. Both were a list somebody forgot to update.
 *
 * WHAT A PERMISSION IS
 *
 * `resource.action` — the same shape the `role_permissions` table already uses
 * (resource, action), so the DB layer in the next phase stores exactly this
 * without a translation step.
 *
 * A permission answers "may this person do X", never "who are they" and never
 * "what does the screen look like". Sidebar filtering consumes permissions; it
 * is not itself a permission, and hiding a menu entry has never been security.
 *
 * ONE VOCABULARY OF VERBS: view, create, update, delete, manage, review,
 * decide, approve, export. `manage` implies the write verbs for that resource
 * and is granted instead of them, not as well. The database's seeded rows use
 * `view` for some roles and `read` for others — team_lead and hr got `read`
 * where manager got `view` — which is why a check written against either word
 * answered false for half the org. That table is repaired against this list in
 * the next phase.
 *
 * DEFAULTS, NOT POLICY. The role lists below are the shipped defaults. A
 * tenant that wants something else gets it through the override layer, not by
 * editing this file. What this file guarantees is that there is exactly one
 * place the defaults are written down.
 *
 * BEHAVIOUR-PRESERVING BY CONSTRUCTION. Every list here was read off the code
 * it replaces, not redesigned. tests/permissionParity.test.js re-derives the
 * old answers from the old sources and asserts this catalogue agrees for all
 * twelve roles. If a list here is wrong, that test fails; it is not a matter of
 * review.
 */

import { ROLES } from "@/utils/roles";

/**
 * Role bundles.
 *
 * Named for WHO they are, not what they open, because the same bundle guards
 * unrelated things and a name like `PROJECT_ROLES` would be wrong at half its
 * call sites. These are the exact groupings the replaced code used.
 */
const OWNER_ONLY = ["owner"];
const ADMINS = ["owner", "admin"];
/** Employee and people operations. */
const PEOPLE = ["owner", "admin", "hr"];
/** Task and delivery oversight. */
const SUPERVISORS = ["owner", "admin", "manager", "team_lead"];
/**
 * The read-only people screens. Wider than PEOPLE because a manager deciding
 * who to assign needs to see who is free — and nothing on those screens writes.
 */
const PEOPLE_READERS = ["owner", "admin", "hr", "manager", "team_lead"];
/** Money, and deliberately NOT the monitoring surface. */
const BILLING = ["owner", "admin", "finance"];
/** Reviewers of submitted work. QA is here and in almost nowhere else. */
const REVIEWERS = ["owner", "admin", "manager", "team_lead", "qa"];
/** Who may bring someone into the org. Wider than PEOPLE by `manager`. */
const INVITERS = ["owner", "admin", "hr", "manager"];
/** Who decides on a client's proposal or change request. */
const DECIDERS = ["owner", "admin", "manager"];
/** Who files work for review — everyone who produces something. */
const CONTRIBUTORS = ["developer", "designer", "devops", "qa", "employee", "team_lead"];

/**
 * The registry.
 *
 * `key` is the contract — it appears in route guards, in the sidebar map, and
 * (next phase) as a row in the database. Renaming one is a breaking change.
 * `legacy` records the name the old `can()` switch used, so the compatibility
 * shim and its parity test have something to key on rather than a second map.
 */
export const PERMISSIONS = Object.freeze([
  // ── Organization ────────────────────────────────────────────────────────
  { key: "organization.manage", roles: OWNER_ONLY, module: "organization", label: "Change organization settings", legacy: "manage_org" },
  { key: "organization.settings", roles: OWNER_ONLY, module: "organization", label: "Open organization settings", legacy: "manage_settings" },
  { key: "organization.delete", roles: OWNER_ONLY, module: "organization", label: "Delete the organization", legacy: "delete_org" },
  { key: "organization.view", roles: PEOPLE, module: "organization", label: "View the organization screen" },

  // ── People ──────────────────────────────────────────────────────────────
  { key: "member.view", roles: PEOPLE, module: "people", label: "View the employee directory" },
  { key: "member.manage", roles: PEOPLE, module: "people", label: "Add and edit members", legacy: "manage_members" },
  { key: "member.invite", roles: INVITERS, module: "people", label: "Send an invitation", legacy: "invite_members" },
  { key: "member.provision", roles: INVITERS, module: "people", label: "Create a login for a member" },
  { key: "member.create", roles: PEOPLE, module: "people", label: "Create a staff account", legacy: "create_developer" },
  // ADMINS, not PEOPLE, and this one is visible to a user. `can()` filed it
  // under owner/admin/hr and EmployeeDirectory really does use it to draw the
  // Delete control — but /api/developer/delete has always been owner/admin, so
  // an HR user saw a button that answered 403 every time they pressed it.
  // Deleting a staff account also destroys their projects, tasks, submissions
  // and activity logs and cannot be undone; where two sources disagree about
  // who may do that, the answer is the smaller list.
  { key: "member.delete", roles: ADMINS, module: "people", label: "Delete a staff account", legacy: "delete_developer" },
  { key: "member.sync_roles", roles: ADMINS, module: "people", label: "Re-sync role claims" },
  { key: "employee.manage", roles: PEOPLE, module: "people", label: "Manage employee records", legacy: "manage_employees" },
  { key: "employee.onboard", roles: PEOPLE, module: "people", label: "Onboard and offboard", legacy: "onboard_offboard" },
  { key: "employee.transfer", roles: PEOPLE, module: "people", label: "Move someone between teams", legacy: "transfer_employee" },
  { key: "employee.activate", roles: PEOPLE, module: "people", label: "Activate or suspend an account", legacy: "activate_employee" },
  { key: "team.manage", roles: PEOPLE, module: "people", label: "Create and edit teams", legacy: "manage_teams" },
  { key: "hierarchy.view", roles: PEOPLE_READERS, module: "people", label: "View the org structure" },
  { key: "capacity.view", roles: PEOPLE_READERS, module: "people", label: "View who is free" },
  { key: "team_stats.view", roles: PEOPLE, module: "people", label: "View headcount statistics" },
  { key: "team.view", roles: SUPERVISORS, module: "people", label: "View team oversight", legacy: "view_team" },

  // ── Projects ────────────────────────────────────────────────────────────
  { key: "project.view_all", roles: SUPERVISORS, module: "projects", label: "View every project" },
  { key: "project.create", roles: SUPERVISORS, module: "projects", label: "Start a project", legacy: "create_project" },
  { key: "project.delete", roles: ADMINS, module: "projects", label: "Delete a project", legacy: "delete_project" },
  { key: "project.assign_manager", roles: ADMINS, module: "projects", label: "Assign a project manager" },
  // DECIDERS, not ADMINS: assembling a project team is what a manager does.
  // Deliberately NOT widened to team_lead — being able to add yourself to a
  // project would make project scoping self-service and defeat the point.
  //
  // This key is also the first one that means something PER PROJECT. Because
  // `manager` is in the list, a person whose project_members row on THIS
  // project says 'manager' matches it through permissionEngine's projectRoles
  // branch, even without the organization-wide role. The route pairs it with
  // mayActOnProject(), which is the half that restricts.
  { key: "project.manage_members", roles: DECIDERS, module: "projects", label: "Add and remove people on a project" },
  { key: "project.close", roles: ADMINS, module: "projects", label: "Close a project" },
  // THE OUTER GATE ONLY. The closure route also requires that a manager or
  // team lead own the project they are completing (`manager_id` is them, or
  // nobody). That ownership rule has no expression here and MUST stay in the
  // route: a role-only check would let every manager in the org complete every
  // project.
  { key: "project.complete", roles: SUPERVISORS, module: "projects", label: "Mark a project complete" },
  { key: "project.hub", roles: SUPERVISORS, module: "projects", label: "Open the project hub" },
  { key: "project.board", roles: ADMINS, module: "projects", label: "Open the board" },

  // ── Delivery ────────────────────────────────────────────────────────────
  { key: "task.manage", roles: SUPERVISORS, module: "delivery", label: "Create and assign tasks", legacy: "manage_tasks" },
  { key: "task.view_all", roles: SUPERVISORS, module: "delivery", label: "View every task" },
  { key: "task.review", roles: REVIEWERS, module: "delivery", label: "Review submitted work", legacy: "review_tasks" },
  { key: "task.submit", roles: CONTRIBUTORS, module: "delivery", label: "Submit work for review", legacy: "submit_task" },
  { key: "sprint.view", roles: SUPERVISORS, module: "delivery", label: "Open sprints" },
  { key: "bug.triage", roles: REVIEWERS, module: "delivery", label: "Triage the bug queue" },

  // ── Client-facing ───────────────────────────────────────────────────────
  { key: "proposal.view", roles: SUPERVISORS, module: "clients", label: "View incoming requests" },
  { key: "proposal.decide", roles: DECIDERS, module: "clients", label: "Accept or reject a request" },
  { key: "change_request.view", roles: SUPERVISORS, module: "clients", label: "View change requests" },
  { key: "change_request.create", roles: DECIDERS, module: "clients", label: "Raise a change request" },
  { key: "change_request.decide", roles: DECIDERS, module: "clients", label: "Advance a change request" },
  // DELIBERATELY NARROWER THAN change_request.decide, which includes manager.
  // A manager who priced the work must not also be the one who agrees to sell
  // it at that price — the two-person rule the advance route already enforces.
  { key: "change_request.approve", roles: ADMINS, module: "clients", label: "Approve a change request for sale" },
  { key: "client.view", roles: BILLING, module: "clients", label: "View client accounts" },
  { key: "client.notify", roles: DECIDERS, module: "clients", label: "Message a client" },
  // ITS OWN KEY, deliberately, and role-identical to client.notify today.
  //
  // The call site (TaskDetailDrawer) used to name three roles inline and argued
  // for it: borrowing a capability "whose membership is free to drift for
  // unrelated reasons" would be wrong. That argument is right, and it is an
  // argument against REUSING a key — not against having one. A key of its own
  // gets the pinning the comment wanted AND puts the set where every other
  // permission lives, so a later divergence is an edit here rather than a
  // second copy of the role vocabulary in a component.
  { key: "task.set_client_visibility", roles: DECIDERS, module: "clients", label: "Decide what the client sees on a task" },

  // ── Money ───────────────────────────────────────────────────────────────
  { key: "billing.view", roles: BILLING, module: "billing", label: "View billing", legacy: "view_billing" },
  { key: "billing.manage", roles: BILLING, module: "billing", label: "Change the subscription", legacy: "manage_billing" },
  // NARROWER THAN billing.manage ON PURPOSE. Starting a subscription,
  // cancelling one and opening the Stripe customer portal are owner-only in
  // every route that does them, and each of those files says so: an admin may
  // read the billing page but may not commit the organization to a recurring
  // charge. Mapping them to `billing.manage` would have handed that to admin
  // and finance under cover of a refactor.
  { key: "billing.purchase", roles: OWNER_ONLY, module: "billing", label: "Buy, cancel or change the plan" },

  // ── Oversight ───────────────────────────────────────────────────────────
  { key: "report.view", roles: SUPERVISORS, module: "oversight", label: "Open reports", legacy: "view_reports" },
  { key: "monitoring.view", roles: ADMINS, module: "oversight", label: "View developer activity", legacy: "view_tracking" },
  { key: "automation.manage", roles: ADMINS, module: "oversight", label: "Configure automation", legacy: "manage_automation" },
  { key: "system.health", roles: ADMINS, module: "oversight", label: "Open system health" },
  { key: "system.audit", roles: ADMINS, module: "oversight", label: "Run the auth audit" },
  // OWNER ONLY, and the only capability in this file that does not extend to
  // admin. Whoever can write a permission override can write themselves one,
  // so this is the key that hands out every other key. It matches the RLS
  // write policy on user_permissions (migration 069) rather than being a
  // second opinion about it.
  { key: "permissions.manage", roles: OWNER_ONLY, module: "oversight", label: "Grant and revoke individual permissions" },
  // Role-identical to hierarchy.view and capacity.view today. Its own key
  // because it means something else, and reusing one of those would make a
  // later divergence a data migration instead of an edit.
  { key: "signal.view", roles: PEOPLE_READERS, module: "oversight", label: "View delivery signals" },
]);

/**
 * DEEP FREEZE, and it is not ceremony.
 *
 * `Object.freeze(PERMISSIONS)` freezes the ARRAY. The entries stayed writable
 * and their `roles` arrays stayed mutable, and because the bundles above are
 * shared array objects, one `push` widened every permission in that bundle at
 * once:
 *
 *   defaultRolesFor("organization.manage").push("developer")
 *   → roleCan("developer", "organization.delete") === true
 *
 * `ADMIN_SECTION_ROLES` takes a copy at import, so the sidebar would have gone
 * on rendering the correct answer while the resolver was compromised — a
 * widening with nothing on screen to show for it. Found by adversarial review;
 * the freeze test only ever checked the derived copy, which decides nothing.
 */
for (const entry of PERMISSIONS) {
  Object.freeze(entry.roles);
  Object.freeze(entry);
}

/** Every key, for membership tests and for the DB seed. */
export const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map((p) => p.key));

/** key → entry. Built once; `resolve` runs on every render. */
const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** legacy `can()` name → key, for the compatibility shim only. */
export const LEGACY_KEYS = Object.freeze(
  Object.fromEntries(PERMISSIONS.filter((p) => p.legacy).map((p) => [p.legacy, p.key]))
);

export function permissionEntry(key) {
  return BY_KEY.get(key) || null;
}

export function isPermissionKey(key) {
  return BY_KEY.has(key);
}

/** The default roles for a key, or [] for a key that does not exist. */
const NO_ROLES = Object.freeze([]);
export function defaultRolesFor(key) {
  // Frozen by the loop above, so this is the real list and callers still
  // cannot grow it. Returning a copy instead would be a per-call allocation on
  // the hottest path in the product.
  return BY_KEY.get(key)?.roles || NO_ROLES;
}

/**
 * Every permission a role holds by default.
 *
 * Used by the DB seed and by the "nobody is stranded" test — a role admitted
 * to the product with an empty permission set is a role whose screens are all
 * locked, which reads as a broken account rather than a restricted one.
 */
export function permissionsForRole(role) {
  return PERMISSIONS.filter((p) => p.roles.includes(role)).map((p) => p.key);
}

/** Modules, in catalogue order, for grouping a permissions editor later. */
export const PERMISSION_MODULES = Object.freeze([
  ...new Set(PERMISSIONS.map((p) => p.module)),
]);

/**
 * Sanity, checked at import rather than left to a test that might not run:
 * every role named in the catalogue has to be a real role. A typo here would
 * silently grant nothing to nobody, which is invisible until somebody reports
 * that a screen they own will not open.
 */
for (const entry of PERMISSIONS) {
  for (const role of entry.roles) {
    if (!ROLES.includes(role)) {
      throw new Error(`permissionCatalogue: "${entry.key}" names unknown role "${role}"`);
    }
  }
}
