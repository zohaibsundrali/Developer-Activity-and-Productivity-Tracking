/** Subscription teardown alone cannot cancel callbacks already queued by realtime. */
export function createKeyboardRealtimeGuard({ organizationId, identity, scope, developer, start, end,
  getOrganizationId, getIdentity, getScope, canMonitor }) {
  let disposed = false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const ids = new Set([developer?.id, developer?.user_id].filter(Boolean));
  return {
    dispose() { disposed = true; },
    accepts(row) {
      if (disposed || !organizationId || !identity || !canMonitor()
        || getOrganizationId() !== organizationId || getIdentity() !== identity || getScope() !== scope
        || !row?.id || row.organization_id !== organizationId) return false;
      // An explicit different profile must not be rescued by a reused email.
      if (row.developer_id ? !ids.has(row.developer_id) : !developer?.email || row.user_email !== developer.email) return false;
      const time = Date.parse(row.tracked_at);
      return Number.isFinite(time) && Number.isFinite(startMs) && Number.isFinite(endMs) && time >= startMs && time < endMs;
    },
  };
}
