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
  Rocket,
  Columns3,
  Gauge,
  FileBarChart,
  Zap,
  CreditCard,
  HeartPulse,
} from "lucide-react";

// Re-exported so existing imports keep working; the definitions live in
// sectionTitles.js, which has no icon dependency.
export { SECTION_TITLES, sectionTitle } from "@/components/shell/sectionTitles";

// Admin sidebar items — ids MUST match the ?section= switch in the admin dashboard.
export const ADMIN_NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "all-projects", label: "All Projects", icon: FolderKanban },
  { id: "project-hub", label: "Project Hub", icon: Gauge },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "views", label: "Views", icon: Columns3 },
  { id: "sprints", label: "Sprints", icon: Rocket },
  { id: "task-reviews", label: "Task Reviews", icon: ClipboardCheck },
  { id: "developer-activity", label: "Developer Activity", icon: Activity },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "automation", label: "Automation", icon: Zap },
  { id: "add-developer", label: "Add Developer", icon: UserPlus },
  { id: "view-developers", label: "View Developers", icon: Users },
  { id: "employees", label: "Employees", icon: Contact },
  { id: "team-stats", label: "Team Stats", icon: BarChart3 },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "clients", label: "Clients", icon: Handshake },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "system-health", label: "System Health", icon: HeartPulse },
  // Personal, not workspace: the signed-in person's own name, email and
  // password. Every admin-dashboard user has one, so it is never filtered out.
  { id: "account", label: "Account", icon: UserCircle },
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
  "project-hub": ["owner", "admin", "manager", "team_lead"],
  board: ["owner", "admin"],
  views: ["owner", "admin", "manager", "team_lead"],
  sprints: ["owner", "admin", "manager", "team_lead"],
  // QA is here and nowhere else on this map: reviewing submitted work is the
  // job the role exists for. Manager and team_lead join it because they were
  // already reviewers everywhere except this sidebar entry.
  "task-reviews": ["owner", "admin", "manager", "team_lead", "qa"],
  "developer-activity": ["owner", "admin"],
  reports: ["owner", "admin", "manager", "team_lead"],
  automation: ["owner", "admin"],
  "add-developer": ["owner", "admin", "hr"],
  "view-developers": ["owner", "admin", "hr"],
  employees: ["owner", "admin", "hr"],
  "team-stats": ["owner", "admin", "hr"],
  organization: ["owner", "admin", "hr"],
  clients: ["owner", "admin", "finance"],
  billing: ["owner", "admin", "finance"],
  // Infrastructure failure detail — same two roles the RLS policy on
  // system_events admits (migration 038).
  "system-health": ["owner", "admin"],
  // null, like `overview`: this shows the caller their OWN details and changes
  // their OWN password. There is no role that should be denied its own account,
  // and the route behind it always targets the verified caller, never an id
  // from the page.
  account: null,
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

// Human-readable titles per section.
//
// SINGLE SOURCE OF TRUTH for a section's name. Three surfaces read it and must
// never disagree:
//   1. the topbar, via sectionTitle() in each dashboard page,
//   2. the page <h1>, via <PageHeader title={sectionTitle(id, role)} />,
//   3. the sidebar, whose ADMIN_NAV/staff labels are the same words (shortened
//      only where the sidebar cannot fit them — "Reports" for "Reports &
//      Analytics" — never re-worded).
//
// Convention: Title Case. Section names are proper names of places in the
// product, they are what the sidebar and topbar already used, and the E2E
// specs address screens by these exact strings. Sentence case stays where it
// belongs — <Section> titles, card titles and descriptions inside a page.

