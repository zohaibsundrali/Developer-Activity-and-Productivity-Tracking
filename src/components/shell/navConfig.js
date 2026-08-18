import {
  LayoutDashboard,
  FolderKanban,
  ClipboardCheck,
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
  Inbox,
  Lightbulb,
  GitPullRequestArrow,
  Bug,
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
  KeyRound,
  Network,
  GaugeCircle as Gauge2,
} from "lucide-react";

// Re-exported so existing imports keep working; the definitions live in
// sectionTitles.js, which has no icon dependency.
export { SECTION_TITLES, sectionTitle } from "@/components/shell/sectionTitles";

// Admin sidebar items — ids MUST match the ?section= switch in the admin dashboard.
export const ADMIN_NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "all-projects", label: "All Projects", icon: FolderKanban },
  // Sits directly under All Projects: a request IS a project that has not
  // been agreed to yet, so it belongs beside the projects rather than off in
  // an admin corner where nobody would look for it.
  { id: "requests", label: "Requests", icon: Inbox },
  { id: "change-requests", label: "Change Requests", icon: GitPullRequestArrow },
  { id: "project-hub", label: "Project Hub", icon: Gauge },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "views", label: "Views", icon: Columns3 },
  { id: "sprints", label: "Sprints", icon: Rocket },
  { id: "task-reviews", label: "Task Reviews", icon: ClipboardCheck },
  { id: "bugs", label: "Bugs", icon: Bug },
  { id: "developer-activity", label: "Developer Activity", icon: Activity },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "automation", label: "Automation", icon: Zap },
  // "Add Developer" and "View Developers" were both here. The People section
  // is now one screen: Employees creates the account, lists everyone with the
  // headcount per role, and carries the deactivate and delete controls the
  // developer list used to own. Three sidebar entries covering overlapping
  // halves of the same people is how somebody ends up looking for a colleague
  // on the screen that does not have them. Old ?section= links for both still
  // resolve — see LEGACY_SECTIONS in the admin dashboard.
  { id: "employees", label: "Employees", icon: Contact },
  // Project -> manager -> team. Sits beside Employees because it answers the
  // other half of the same question: Employees says who works here, this says
  // what they are working on.
  { id: "hierarchy", label: "Team Structure", icon: Network },
  // The same graph from the other end: Team Structure says who is on a
  // project, this says what one person is carrying across all of them.
  { id: "capacity", label: "Capacity", icon: Gauge2 },
  { id: "team-stats", label: "Team Stats", icon: BarChart3 },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "clients", label: "Clients", icon: Handshake },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "system-health", label: "System Health", icon: HeartPulse },
  // Beside System Health rather than beside Employees: this screen is about
  // what people MAY DO, which is an administration question, and putting it in
  // the People group would invite it to be read as part of managing a person.
  { id: "permissions", label: "Permissions", icon: KeyRound },
  // Personal, not workspace: the signed-in person's own name, email and
  // password. Every admin-dashboard user has one, so it is never filtered out.
  { id: "account", label: "Account", icon: UserCircle },
  // { id: "productivity", label: "Productivity", icon: BarChart3 },
];

// Developer sidebar items — ids MUST match the ?section= switch in the developer dashboard.
export const DEVELOPER_NAV = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "My Projects", icon: FolderKanban },
  // `new-project` and `change-requests` USED TO BE HERE, and both were dead:
  // the developer dashboard has no case for either, so they fell through to
  // Dashboard. They belong to the CLIENT portal — which renders both, and
  // whose section titles are the only ones defined for them — so that is where
  // they now are. See CLIENT_NAV.
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

// Re-exported so existing imports keep working; the table itself lives in
// sectionAccess.js, which has no icon dependency and can therefore be read by
// the edge middleware.
export {
  ADMIN_SECTION_ROLES,
  ADMIN_AREA_ROLES,
  canAccessAdminSection,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";

import { canAccessAdminSection } from "@/components/shell/sectionAccess";

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
  // Directly under My Projects: proposing one is the same subject as having
  // one, and a client looking to start something looks there first. Both of
  // these were in DEVELOPER_NAV, where nothing rendered them — so a client
  // could not raise a proposal or a change request at all, and the two modules
  // built for them were unreachable from the UI.
  { id: "new-project", label: "New Project", icon: Lightbulb },
  { id: "change-requests", label: "Change Requests", icon: GitPullRequestArrow },
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

