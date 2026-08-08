import {
  Bell,
  UserPlus,
  ArrowRightLeft,
  AtSign,
  MessageSquare,
  Clock,
  ClipboardCheck,
  Rocket,
  FolderKanban,
  Users,
  Zap,
  TriangleAlert,
} from "lucide-react";

/**
 * How a notification looks, in one place.
 *
 * The dropdown and the history page show the same rows at different sizes. The
 * two admin/developer dropdowns that preceded the notification centre were also
 * "the same rows at a different size", and they drifted into different icons
 * and different time formats for identical data. Splitting the icon map, the
 * tone classes and the timestamp out of the panel is what stops that happening
 * a second time between the panel and the page.
 */

// `categoryMeta` names a lucide icon; lucide has no runtime lookup by name, and
// a dynamic import of the whole set would pull the entire library into the
// bundle, so the eleven categories are wired up explicitly.
export const CATEGORY_ICONS = {
  UserPlus,
  ArrowRightLeft,
  AtSign,
  MessageSquare,
  Clock,
  ClipboardCheck,
  Rocket,
  FolderKanban,
  Users,
  Zap,
  Bell,
};

// `tone` from the category metadata, mapped onto the semantic classes that
// already exist — no new colour values enter the design system here.
export const TONE_CLASSES = {
  info: "bg-info/10 text-info",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  muted: "bg-muted text-muted-foreground",
};

// The same five tones expressed as ui-kit Badge variants, so a chip built from
// category metadata and a chip built by hand cannot end up different shapes.
export const TONE_BADGE_VARIANT = {
  info: "info",
  primary: "default",
  success: "success",
  warning: "warning",
  muted: "secondary",
};

export function categoryIcon(meta) {
  return CATEGORY_ICONS[meta?.icon] || Bell;
}

export function toneClass(meta) {
  return TONE_CLASSES[meta?.tone] || TONE_CLASSES.muted;
}

export function toneBadgeVariant(meta) {
  return TONE_BADGE_VARIANT[meta?.tone] || TONE_BADGE_VARIANT.muted;
}

/* ------------------------------------------------------------------ *
 * Priority.
 *
 * A notification row carries no priority column — the only thing it says
 * about its own urgency is its category. So priority is DERIVED here, in
 * one place, rather than each surface inventing its own emphasis: a thing
 * with a clock on it (due & overdue) and a thing that names you directly
 * (a mention) are the two that go stale if they are not seen today;
 * automation chatter is the class you can read next week.
 *
 * Deliberately three levels and not five. The whole difficulty of this
 * screen is that shouting about everything is identical to shouting about
 * nothing, so only `high` gets any extra ink at all, and it only gets it
 * while the row is still unread — once it has been read the emphasis has
 * done its job and comes back off.
 * ------------------------------------------------------------------ */

export const PRIORITY_HIGH_CATEGORIES = ["deadline", "mention"];
export const PRIORITY_LOW_CATEGORIES = ["automation", "general"];

export const PRIORITY_META = {
  high: {
    key: "high",
    label: "Needs attention",
    // A rail, not a filled row: it reads down the left edge of the list as a
    // scannable column rather than turning a card amber.
    rail: "bg-warning",
    badgeVariant: "warning",
    icon: TriangleAlert,
    rank: 0,
  },
  normal: {
    key: "normal",
    label: "Normal",
    rail: "bg-primary",
    badgeVariant: "secondary",
    icon: null,
    rank: 1,
  },
  low: {
    key: "low",
    label: "Low",
    rail: "bg-border",
    badgeVariant: "secondary",
    icon: null,
    rank: 2,
  },
};

export function notificationPriority(category) {
  if (PRIORITY_HIGH_CATEGORIES.includes(category)) return "high";
  if (PRIORITY_LOW_CATEGORIES.includes(category)) return "low";
  return "normal";
}

export function priorityMeta(category) {
  return PRIORITY_META[notificationPriority(category)] || PRIORITY_META.normal;
}

/**
 * The left rail for one row.
 *
 * Read rows get no rail at all: unread is the primary distinction on this
 * screen and it has to survive a row also being high priority, so the rail
 * says "unread" first and "how unread" second.
 */
export function railClass({ read, category }) {
  if (read) return "bg-transparent";
  return priorityMeta(category).rail;
}

export function getTimeAgo(dateString) {
  if (!dateString) return "";
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 120) return "1 minute ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 7200) return "1 hour ago";
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 172800) return "1 day ago";
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** The clock time, for a page that has room to show when as well as how long ago. */
export function getClockTime(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Which day-heading a notification belongs under.
 *
 * Measured from local midnight, not as a count of hours: "Yesterday" is a
 * calendar day to the person reading it, so something sent at 9pm is still
 * under Today at 11pm — where an elapsed-hours rule would have filed it under
 * Yesterday while the day it happened was still going on.
 */
export function dayBucket(dateString, now = new Date()) {
  if (!dateString) return "earlier";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "earlier";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (date >= startOfToday) return "today";

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date >= startOfYesterday) return "yesterday";

  return "earlier";
}

export const DAY_BUCKETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "earlier", label: "Earlier" },
];
