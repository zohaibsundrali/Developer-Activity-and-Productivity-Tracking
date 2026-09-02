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
import { canEnterAdminArea } from "./sectionAccess";
import { DASHBOARD_HOME } from "@/utils/dashboardHome";

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

// Deliberately still "devtrack.*" after the rename to Verisade — see AppShell.
// Renaming it would wipe every existing user's recent searches for no gain.
export const RECENT_SEARCHES_KEY = "devtrack.recentSearches.v1";
export const RECENT_SEARCHES_LIMIT = 6;

// Each dashboard drives its sections from `?section=`, so a command is just the
// dashboard route plus the section id the sidebar already uses. The routes
// themselves are shared with the marketing header, which needs the same answer
// for its "Dashboard" button — see utils/dashboardHome.js.
const DASHBOARD_ROUTE = DASHBOARD_HOME;

/**
 * The membership role to judge this session by.
 *
 * `membership_role` can be absent on legacy admin rows — the admin dashboard
 * itself falls back to "admin", so the palette has to fall back identically or
 * the two lists disagree about what that person may open.
 */
export function roleFor(ctx) {
  return ctx?.role || (ctx?.userType === "admin" ? "admin" : "developer");
}

/**
 * WHICH SHELL this session actually lives in: "admin", "developer", "client",
 * or null when nobody is signed in.
 *
 * THE BUG THIS EXISTS TO FIX, and it is a role/user_type confusion.
 *
 *  `navCommandsFor` used to branch on `userType`, and userType cannot answer
 *  this question. `userTypeForRole` files EVERY role except owner and admin in
 *  the `developers` table, so a manager, a team lead, an HR user, a QA and a
 *  finance user all sign in carrying `userType: "developer"`. Meanwhile
 *  `dashboardHomeFor` routes anyone matching `canEnterAdminArea(role)` to
 *  /admin/dashboard — which is all five of them.
 *
 *  So a manager landed on the admin dashboard, pressed Ctrl+K, and was offered
 *  the six-entry STAFF nav pointing at `/developer/dashboard?section=…`: not
 *  one of the sections they actually work in (All Projects, Sprints, Task
 *  Reviews, Employees…), and clicking any of them navigated them clean out of
 *  their own shell. The palette is always mounted with an ungated Cmd/Ctrl+K
 *  listener, so this was one keystroke away on every screen they had.
 *
 * The answer is the ROLE, via the same `canEnterAdminArea` the middleware, the
 * login page and `dashboardHomeFor` use — one rule, four readers, no fourth
 * copy invented here.
 */
export function shellFor(ctx) {
  const userType = ctx?.userType || null;
  if (!userType) return null;
  // A client is a client whatever else is on the session: the client portal is
  // not reachable by role, and canEnterAdminArea has no opinion about "client".
  if (userType === "client") return "client";
  return canEnterAdminArea(roleFor(ctx)) ? "admin" : "developer";
}

/**
 * Navigation commands for the signed-in user.
 *
 * The split mirrors the dashboards exactly: admin-shell users get
 * adminNavFor(role) (already filtered by ADMIN_SECTION_ROLES), staff get
 * staffNav(role) (which is what decides whether Team appears), and a client gets
 * the client portal sections and nothing else.
 */
export function navCommandsFor(ctx) {
  const shell = shellFor(ctx);
  if (!shell) return [];

  if (shell === "client") {
    return toCommands(CLIENT_NAV, DASHBOARD_ROUTE.client, "client");
  }

  const role = roleFor(ctx);

  if (shell === "admin") {
    return toCommands(adminNavFor(role), DASHBOARD_ROUTE.admin, "admin");
  }

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
  // Compared against the SHELL, not against ctx.userType. A manager's commands
  // are tagged "admin" because that is the shell they live in, while their
  // userType is "developer" — comparing the two directly would have rejected
  // every command the palette had just built for them.
  const shell = shellFor(ctx);
  if (command.userType !== shell) return false;
  if (shell !== "admin") return true;
  return canAccessAdminSection(command.sectionId, roleFor(ctx));
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

/* ------------------------------------------------------------------ *
 * Match highlighting.
 *
 * Pure, and here rather than in the palette, because "which characters
 * matched" is list-building rather than rendering — and because a regex
 * built from user input is exactly the kind of thing that wants to be
 * testable on its own.
 * ------------------------------------------------------------------ */

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value) {
  return String(value).replace(REGEX_SPECIALS, "\\$&");
}

/**
 * Split `text` into matched / unmatched runs against the search term.
 *
 * Every whitespace-separated token is highlighted independently, so
 * "auth bug" marks both words in "Auth bug on login" rather than nothing:
 * the server matches loosely, and a highlight that is stricter than the
 * match makes correct results look like mistakes.
 *
 * Returns `[{ text, match }]`, always covering the whole string exactly
 * once, so the caller can render it without re-deriving offsets.
 */
export function highlightSegments(text, term) {
  const source = typeof text === "string" ? text : text === 0 ? "0" : String(text || "");
  if (!source) return [];

  const tokens = String(term || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Longest first: "project" must win over "pro" where both would match,
    // otherwise the shorter run splits the longer one in half.
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);

  if (tokens.length === 0) return [{ text: source, match: false }];

  const pattern = new RegExp(`(${tokens.join("|")})`, "gi");
  const segments = [];
  let cursor = 0;

  for (const found of source.matchAll(pattern)) {
    const start = found.index ?? 0;
    if (start > cursor) segments.push({ text: source.slice(cursor, start), match: false });
    segments.push({ text: found[0], match: true });
    cursor = start + found[0].length;
  }

  if (cursor < source.length) segments.push({ text: source.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text: source, match: false }];
}

/**
 * What to try when a search comes back with nothing, or before one starts.
 *
 * An empty state that only says "no results" tells someone what they already
 * knew; these say what this particular box is good at.
 */
export const SEARCH_SUGGESTIONS = [
  "a project name",
  "a task title or key",
  "a teammate's name",
  "a client",
  "a sprint or epic",
];

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
