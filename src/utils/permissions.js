import { getOrgContext } from "@/utils/orgContext";

/**
 * Lightweight role-based access control for the multi-tenant SaaS.
 * Roles (highest → lowest): owner, admin, manager, hr, team_lead, developer,
 * employee, client. The DB `role_permissions` table holds the fine-grained
 * matrix; this helper is the app-layer gate for UI/actions.
 */
const ROLE_RANK = {
  owner: 8,
  admin: 7,
  manager: 6,
  hr: 5,
  team_lead: 4,
  developer: 3,
  employee: 2,
  client: 1,
};

// Capability groups.
const ADMINS = ["owner", "admin"];                       // org administration
const PEOPLE_MANAGERS = ["owner", "admin", "hr"];        // employee/people ops
const SUPERVISORS = ["owner", "admin", "manager", "team_lead"]; // task/team oversight

export function getRole() {
  return getOrgContext()?.role || null;
}

export function hasRole(...roles) {
  const r = getRole();
  return r ? roles.includes(r) : false;
}

export function atLeast(role) {
  const r = getRole();
  return !!r && (ROLE_RANK[r] || 0) >= (ROLE_RANK[role] || 99);
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
    // Project administration — Owner, Admin.
    case "create_project":
    case "delete_project":
    case "manage_automation":
      return ADMINS.includes(r);
    // Task/team oversight — Owner, Admin, Manager, Team Lead.
    case "review_tasks":
    case "manage_tasks":
    case "view_tracking":
    case "view_reports":
    case "view_team":
      return SUPERVISORS.includes(r);
    case "submit_task":
      return ["developer", "employee", "team_lead"].includes(r);
    default:
      return true;
  }
}
