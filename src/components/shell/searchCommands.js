import {
  FolderKanban,
  CheckSquare,
  Rocket,
  Layers,
  Users,
  Contact,
  Handshake,
  MessageSquare,
  FileText,
} from "lucide-react";
import { adminNavFor, staffNav, CLIENT_NAV, canAccessAdminSection } from "./navConfig";

/**
 * Data model behind the command palette.
 *
 * Everything here is pure so the palette's render body stays free of list
 * building, and so the navigation commands can only ever be as permissive as
 * the sidebar: they are derived from navConfig rather than hand-listed. A
 * second copy of "which pages exist and who may see them" would drift away from
 * the sidebar the first time a section is added or re-gated.
 */

// The API returns nothing under two characters and issues no queries; the
// palette must not call the route in that case either.
export const MIN_QUERY_LENGTH = 2;

// Long enough that a fast typist fires one request, short enough that the
// result still feels attached to the keystroke.
export const SEARCH_DEBOUNCE_MS = 250;

// Per-type row cap sent as `limit`. `totals` tells us what was left behind.
export const SEARCH_LIMIT = 6;

export const RECENT_SEARCHES_KEY = "devtrack.recentSearches.v1";
export const RECENT_SEARCHES_LIMIT = 6;

// Each dashboard drives its sections from `?section=`, so a command is just the
// dashboard route plus the section id the sidebar already uses.
const DASHBOARD_ROUTE = {
  admin: "/admin/dashboard",
  developer: "/developer/dashboard",
  client: "/client",
};

/**
 * Navigation commands for the signed-in user.
 *
 * The role split mirrors the dashboards exactly: admin-shell users get
 * adminNavFor(role) (already filtered by ADMIN_SECTION_ROLES), staff get
 * staffNav(role) (which is what decides whether Team appears), and a client gets
 * the client portal sections and nothing else.
 */
export function navCommandsFor(ctx) {
  const userType = ctx?.userType || null;
  if (!userType) return [];

  if (userType === "client") {
    return toCommands(CLIENT_NAV, DASHBOARD_ROUTE.client, "client");
  }

  if (userType === "admin") {
    // membership_role can be absent on legacy admin rows — the dashboard itself
    // falls back to "admin", so the palette must fall back identically or the
    // two lists disagree.
    const role = ctx?.role || "admin";
    return toCommands(adminNavFor(role), DASHBOARD_ROUTE.admin, "admin");
  }

  const role = ctx?.role || "developer";
  return toCommands(staffNav(role), DASHBOARD_ROUTE.developer, "developer");
}

function toCommands(navItems, basePath, userType) {
  return navItems.map((item) => ({
    key: `command:${userType}:${item.id}`,
    kind: "command",
    sectionId: item.id,
    title: item.label,
    subtitle: null,
    meta: null,
    href: `${basePath}?section=${item.id}`,
    icon: item.icon,
    tone: "primary",
    userType,
  }));
}

/**
 * Last check before a command actually navigates.
 *
 * navCommandsFor already filtered the list, but the list is held in state while
 * the palette is open — a session that changes underneath it (re-login as a
 * different role) would otherwise leave a stale, now-forbidden row clickable.
 */
export function isNavCommandAllowed(command, ctx) {
  if (!command || command.kind !== "command") return true;
  const userType = ctx?.userType || null;
  if (command.userType !== userType) return false;
  if (userType !== "admin") return true;
  return canAccessAdminSection(command.sectionId, ctx?.role || "admin");
}

// Stable render order for the eight contract types. An explicit array means the
// groups never need sorting.
export const SEARCH_TYPE_ORDER = [
  "project",
  "task",
  "sprint",
  "epic",
  "team",
  "employee",
  "client",
  "comment",
];

export const SEARCH_TYPE_META = {
  project: { label: "Projects", icon: FolderKanban, tone: "primary" },
  task: { label: "Tasks", icon: CheckSquare, tone: "info" },
  sprint: { label: "Sprints", icon: Rocket, tone: "warning" },
  epic: { label: "Epics", icon: Layers, tone: "primary" },
  team: { label: "Teams", icon: Users, tone: "info" },
  employee: { label: "People", icon: Contact, tone: "success" },
  client: { label: "Clients", icon: Handshake, tone: "success" },
  comment: { label: "Comments", icon: MessageSquare, tone: "muted" },
};

export function searchTypeMeta(type) {
  return (
    SEARCH_TYPE_META[type] || {
      // Defensive: a type the UI has not learned about yet still renders as a
      // labelled group instead of disappearing.
      label: typeof type === "string" && type ? type : "Results",
      icon: FileText,
      tone: "muted",
    }
  );
}

/** Case-insensitive substring match over the command labels. */
export function filterNavCommands(commands, term) {
  const needle = term.trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter((command) => command.title.toLowerCase().includes(needle));
}

/**
 * Turn the contract's `results` map into ordered, renderable groups.
 *
 * `href` is allowed to be null and that means "not navigable" — such a row is
 * marked disabled here so it is rendered inert and skipped by the keyboard,
 * rather than dead-ending on Enter.
 */
export function buildResultGroups(results, totals) {
  if (!results || typeof results !== "object") return [];

  const groups = [];
  const seen = new Set();

  const pushGroup = (type) => {
    const hits = results[type];
    if (!Array.isArray(hits) || hits.length === 0) return;
    const meta = searchTypeMeta(type);
    const total = Number.isFinite(totals?.[type]) ? totals[type] : null;
    groups.push({
      key: `type:${type}`,
      label: meta.label,
      // "showing 6 of 41" is the only honest way to read a capped list.
      count: total !== null && total > hits.length ? `${hits.length} of ${total}` : null,
      rows: hits.map((hit, index) => ({
        key: `result:${type}:${hit?.id ?? index}`,
        kind: "result",
        type,
        title: hit?.title || "Untitled",
        subtitle: hit?.subtitle || null,
        meta: hit?.meta && typeof hit.meta === "object" ? hit.meta : null,
        href: typeof hit?.href === "string" && hit.href ? hit.href : null,
        icon: meta.icon,
        tone: meta.tone,
        disabled: !(typeof hit?.href === "string" && hit.href),
      })),
    });
  };

  for (const type of SEARCH_TYPE_ORDER) {
    seen.add(type);
    pushGroup(type);
  }
  for (const type of Object.keys(results)) {
    if (seen.has(type)) continue;
    pushGroup(type);
  }

  return groups;
}

// The chips shown on a result row, in a fixed order. `meta` may carry any
// subset of these keys, or none.
const META_CHIP_KEYS = ["status", "priority", "assignee_name", "project_name", "label"];

export function metaChips(meta) {
  if (!meta) return [];
  const chips = [];
  for (const key of META_CHIP_KEYS) {
    const value = meta[key];
    if (value === null || value === undefined || value === "") continue;
    chips.push({ key, value: String(value) });
  }
  return chips;
}

/**
 * Assign a flat keyboard index across every group, skipping non-navigable rows.
 * One pass produces both the render tree and the ↑/↓ track, so the two can't
 * fall out of step.
 */
export function withFlatIndexes(groups) {
  const flat = [];
  const indexed = groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => {
      if (row.disabled) return { ...row, flatIndex: -1 };
      const flatIndex = flat.length;
      flat.push(row);
      return { ...row, flatIndex };
    }),
  }));
  return { groups: indexed, flat };
}

/* ------------------------------------------------------------------ *
 * Recent searches — terms only. Storing result rows would mean caching
 * org-scoped records in localStorage, which outlives the session.
 * ------------------------------------------------------------------ */

export function loadRecentSearches() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((term) => typeof term === "string" && term.trim()).slice(0, RECENT_SEARCHES_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentSearch(term) {
  const clean = typeof term === "string" ? term.trim() : "";
  if (clean.length < MIN_QUERY_LENGTH) return loadRecentSearches();

  const existing = loadRecentSearches();
  const deduped = existing.filter((entry) => entry.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...deduped].slice(0, RECENT_SEARCHES_LIMIT);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Private mode / quota — recents are a convenience, never a hard failure.
    }
  }
  return next;
}

export function clearRecentSearches() {
  if (typeof window === "undefined") return [];
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // ignore
  }
  return [];
}
