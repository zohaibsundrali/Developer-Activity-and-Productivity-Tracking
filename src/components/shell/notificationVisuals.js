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

export function categoryIcon(meta) {
  return CATEGORY_ICONS[meta?.icon] || Bell;
}

export function toneClass(meta) {
  return TONE_CLASSES[meta?.tone] || TONE_CLASSES.muted;
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
