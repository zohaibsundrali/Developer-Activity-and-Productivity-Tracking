import { getOrgContext } from "@/utils/orgContext";

/**
 * Lightweight role-based access control for the multi-tenant SaaS.
 * Roles (highest → lowest): owner, admin, manager, developer, employee, client.
 * The DB `role_permissions` table holds the fine-grained matrix for later use;
 * this helper is the app-layer gate for UI/actions in Phase 2.
 */
const ROLE_RANK = {
  owner: 6,
  admin: 5,
  manager: 4,
  developer: 3,
  employee: 2,
  client: 1,
};

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

const ADMINS = ["owner", "admin"];

/**
 * Coarse capability check. Keep in sync with the seeded role_permissions rows.
 */
export function can(action) {
  const r = getRole();
  if (!r) return false;
  switch (action) {
    case "manage_org":
    case "manage_members":
    case "manage_settings":
    case "invite_members":
    case "create_developer":
    case "delete_developer":
    case "create_project":
    case "delete_project":
      return ADMINS.includes(r);
    case "review_tasks":
    case "manage_tasks":
    case "view_tracking":
    case "view_reports":
      return ADMINS.includes(r) || r === "manager";
    case "submit_task":
      return ["developer", "employee"].includes(r) || ADMINS.includes(r);
    default:
      return true;
  }
}
