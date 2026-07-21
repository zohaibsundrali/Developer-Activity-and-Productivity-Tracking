import {
  LayoutDashboard,
  FolderKanban,
  ClipboardCheck,
  UserPlus,
  Activity,
  Users,
  UserCircle,
  Building2,
} from "lucide-react";

// Admin sidebar items — ids MUST match the ?section= switch in the admin dashboard.
export const ADMIN_NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "all-projects", label: "All Projects", icon: FolderKanban },
  { id: "task-reviews", label: "Task Reviews", icon: ClipboardCheck },
  { id: "developer-activity", label: "Developer Activity", icon: Activity },
  { id: "add-developer", label: "Add Developer", icon: UserPlus },
  { id: "view-developers", label: "View Developers", icon: Users },
  { id: "organization", label: "Organization", icon: Building2 },
  // { id: "productivity", label: "Productivity", icon: BarChart3 },
];

// Developer sidebar items — ids MUST match the ?section= switch in the developer dashboard.
export const DEVELOPER_NAV = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "My Projects", icon: FolderKanban },
  { id: "account", label: "Account", icon: UserCircle },
];

// Human-readable titles per section (for the topbar).
export const SECTION_TITLES = {
  overview: { admin: "Dashboard Overview", developer: "Dashboard" },
  "all-projects": { admin: "All Projects" },
  "task-reviews": { admin: "Task Reviews" },
  "developer-activity": { admin: "Developer Activity" },
  "add-developer": { admin: "Add Developer" },
  "view-developers": { admin: "View Developers" },
  organization: { admin: "Organization" },
  productivity: { admin: "Productivity" },
  projects: { developer: "My Projects" },
  account: { developer: "Account" },
};

export function sectionTitle(section, role) {
  const entry = SECTION_TITLES[section];
  if (entry && entry[role]) return entry[role];
  return "Dashboard";
}
