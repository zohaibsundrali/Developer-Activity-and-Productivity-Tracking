"use client";
import NotificationCenter from "@/components/shell/NotificationCenter";

/**
 * The developer bell.
 *
 * Renders the shared notification centre; see the admin twin for why the two
 * copies collapsed into one. The old props are still accepted so the dashboard
 * keeps rendering unchanged — the hook inside owns that state now.
 */
export default function NotificationDropdown(props) {
  const user = props.user || null;
  const userId = props.userId || user?.id || null;
  // Developer rows are addressed by id only (developer_id /
  // assigned_developer_id), so no email is passed through.
  return <NotificationCenter audience="developer" userId={userId} email={null} />;
}
