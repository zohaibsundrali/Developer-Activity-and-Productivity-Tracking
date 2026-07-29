import {
  LayoutDashboard,
  FolderKanban,
  ClipboardCheck,
  UserPlus,
  Activity,
  Users,
  UserCircle,
  Building2,
  Megaphone,
  CheckSquare,
  FileText,
  LifeBuoy,
  Receipt,
  Handshake,
  Contact,
  BarChart3,
  LayoutGrid,
} from "lucide-react";

// Admin sidebar items — ids MUST match the ?section= switch in the admin dashboard.
export const ADMIN_NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "all-projects", label: "All Projects", icon: FolderKanban },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "task-reviews", label: "Task Reviews", icon: ClipboardCheck },
  { id: "developer-activity", label: "Developer Activity", icon: Activity },
  { id: "add-developer", label: "Add Developer", icon: UserPlus },
  { id: "view-developers", label: "View Developers", icon: Users },
  { id: "employees", label: "Employees", icon: Contact },
  { id: "team-stats", label: "Team Stats", icon: BarChart3 },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "clients", label: "Clients", icon: Handshake },
  // { id: "productivity", label: "Productivity", icon: BarChart3 },
];

// Developer sidebar items — ids MUST match the ?section= switch in the developer dashboard.
export const DEVELOPER_NAV = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "My Projects", icon: FolderKanban },
  { id: "account", label: "Account", icon: UserCircle },
];

// Manager sidebar items — a manager is staff (developers table, developer_auth)
// with an extra org-scoped Team oversight section.
export const MANAGER_NAV = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "My Projects", icon: FolderKanban },
  { id: "team", label: "Team", icon: Users },
  { id: "account", label: "Account", icon: UserCircle },
];

// Employee sidebar items — individual contributor (same surface as developer).
export const EMPLOYEE_NAV = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "My Projects", icon: FolderKanban },
  { id: "account", label: "Account", icon: UserCircle },
];

// Which roles may see each ADMIN dashboard section. null = every admin-dashboard
// user (owner/admin/hr). Used to filter the sidebar AND to gate section access.
export const ADMIN_SECTION_ROLES = {
  overview: null,
  "all-projects": ["owner", "admin"],
  board: ["owner", "admin"],
  "task-reviews": ["owner", "admin"],
  "developer-activity": ["owner", "admin"],
  "add-developer": ["owner", "admin", "hr"],
  "view-developers": ["owner", "admin", "hr"],
  employees: ["owner", "admin", "hr"],
  "team-stats": ["owner", "admin", "hr"],
  organization: ["owner", "admin", "hr"],
  clients: ["owner", "admin"],
};

export function canAccessAdminSection(section, role) {
  const allowed = ADMIN_SECTION_ROLES[section];
  if (allowed === undefined || allowed === null) return true;
  return allowed.includes(role);
}

// The admin sidebar filtered to the sections a given role may access.
export function adminNavFor(role) {
  return ADMIN_NAV.filter((item) => canAccessAdminSection(item.id, role));
}

// Resolve the correct nav for a staff member based on their membership role.
// developer/manager/employee all share the staff (/developer) dashboard.
export function staffNav(role) {
  // Supervisory staff (manager, team lead, HR) get the Team oversight section.
  if (role === "manager" || role === "team_lead" || role === "hr") return MANAGER_NAV;
  if (role === "employee") return EMPLOYEE_NAV;
  return DEVELOPER_NAV;
}

// Client portal sidebar items — ids MUST match the ?section= switch in the client dashboard.
export const CLIENT_NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "projects", label: "My Projects", icon: FolderKanban },
  { id: "announcements", label: "Announcements", icon: Megaphone },
  { id: "approvals", label: "Approvals", icon: CheckSquare },
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "support", label: "Support", icon: LifeBuoy },
  { id: "account", label: "Account", icon: UserCircle },
];

// Human-readable titles per section (for the topbar).
export const SECTION_TITLES = {
  overview: { admin: "Dashboard Overview", developer: "Dashboard", client: "Overview" },
  "all-projects": { admin: "All Projects" },
  board: { admin: "Project Board" },
  "task-reviews": { admin: "Task Reviews" },
  "developer-activity": { admin: "Developer Activity" },
  "add-developer": { admin: "Add Developer" },
  "view-developers": { admin: "View Developers" },
  employees: { admin: "Employees" },
  "team-stats": { admin: "Team Stats" },
  organization: { admin: "Organization" },
  clients: { admin: "Clients" },
  productivity: { admin: "Productivity" },
  projects: { developer: "My Projects", client: "My Projects" },
  account: { developer: "Account", client: "Account" },
  team: { developer: "Team" },
  announcements: { client: "Announcements" },
  approvals: { client: "Approvals" },
  invoices: { client: "Invoices" },
  support: { client: "Support" },
};

export function sectionTitle(section, role) {
  const entry = SECTION_TITLES[section];
  if (!entry) return "Dashboard";
  // manager/employee share the staff (developer) dashboard, so fall back to
  // the developer title when a role-specific one isn't defined.
  return entry[role] || entry.developer || entry.admin || "Dashboard";
}
