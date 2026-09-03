/**
 * Section titles — the single source for what a screen is called.
 *
 * Split out of `navConfig.js` deliberately. That file imports two dozen lucide
 * icons for the sidebar, so a component wanting nothing but a title string was
 * pulling every one of them into its bundle — and into its tests, where a
 * partial `lucide-react` mock then failed on whichever icon it had not listed.
 * Titles are data; icons are presentation.
 *
 * `navConfig.js` re-exports both names, so existing imports keep working.
 *
 * The sidebar, the topbar and each screen's <h1> all read from here, which is
 * what stops them drifting — and they had drifted: nav said "All Projects"
 * while the heading said "My Projects", and "Team Stats"/"Team stats" and
 * "Task Reviews"/"Task reviews" differed only in case.
 *
 * Moved verbatim, not retyped: a hand-copied version of this table lost six
 * entries and changed one value on the first attempt.
 */

export const SECTION_TITLES = {
  overview: { admin: "Dashboard Overview", developer: "Dashboard", client: "Overview" },
  "all-projects": { admin: "All Projects" },
  requests: { admin: "Requests" },
  "change-requests": { admin: "Change Requests", client: "Change Requests" },
  bugs: { admin: "Bugs" },
  "project-hub": { admin: "Project Hub" },
  board: { admin: "Project Board" },
  views: { admin: "Project Views" },
  sprints: { admin: "Sprints & Agile" },
  "task-reviews": { admin: "Task Reviews" },
  permissions: { admin: "Permissions" },
  "my-work": { admin: "My Work", developer: "My Work" },
  "my-attendance": { admin: "My Attendance", developer: "My Attendance" },
  "my-leave": { admin: "My Leave", developer: "My Leave" },
  "my-reviews": { admin: "My Reviews", developer: "My Reviews" },
  performance: { admin: "Performance" },
  "leave-approvals": { admin: "Leave Approvals" },
  "timesheet-approvals": { admin: "Timesheet Approvals" },
  invoicing: { admin: "Invoicing" },
  quality: { admin: "Quality" },
  timesheet: { admin: "My Timesheet", developer: "My Timesheet" },
  "developer-activity": { admin: "Developer Activity" },
  reports: { admin: "Reports & Analytics" },
  automation: { admin: "Workflow Automation" },
  employees: { admin: "Employees" },
  hierarchy: { admin: "Team Structure" },
  capacity: { admin: "Capacity" },
  "team-stats": { admin: "Team Stats" },
  organization: { admin: "Organization" },
  clients: { admin: "Clients" },
  billing: { admin: "Billing & Subscription" },
  "system-health": { admin: "System Health" },
  productivity: { admin: "Productivity" },
  projects: { admin: "My Projects", developer: "My Projects", client: "My Projects" },
  "new-project": { client: "New Project" },
  account: { admin: "Account", developer: "Account", client: "Account" },
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
