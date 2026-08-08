"use client";
import NotificationCenter from "@/components/shell/NotificationCenter";

/**
 * The admin bell.
 *
 * This and its developer twin were 260 lines of the same component with
 * different icons; both now render the shared notification centre, which owns
 * the list, the true unread count, the filters and the mark-read paths.
 *
 * The old props (`notifications`, `unreadCount`, `onMarkAllAsRead`, `onOpen`,
 * `onLoadMore`, `hasMore`, `isLoadingMore`) are still accepted so the dashboard
 * keeps rendering unchanged — they are simply no longer where the data comes
 * from. `props` is read rather than destructured to keep that explicit.
 */
export default function NotificationDropdown(props) {
  const user = props.user || null;
  const userId = props.userId || user?.id || null;
  // Admin notifications are addressed by id OR by email, so the email matters.
  const email = props.email || user?.email || null;

  return <NotificationCenter audience="admin" userId={userId} email={email} />;
}
