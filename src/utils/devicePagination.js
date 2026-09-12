// Request ownership prevents stale refreshes, account changes and unmounts from
// appending a previous identity's devices. Failed pages keep the visible list.
export function createDevicePager(fetchPage, publish) {
  let generation = 0;
  let abort = null;
  let state = { devices: [], loading: false, error: "", nextCursor: null };
  const emit = update => { state = { ...state, ...update }; publish({ ...state }); };
  return {
    async load(more = false) {
      if (more && (state.loading || !state.nextCursor)) return;
      abort?.abort();
      abort = new AbortController();
      const own = ++generation;
      const cursor = more ? state.nextCursor : null;
      emit({ loading: true, error: "" });
      try {
        const body = await fetchPage(cursor, abort.signal);
        if (own !== generation) return;
        if (!Array.isArray(body.devices) || (body.hasMore && typeof body.nextCursor !== "string")) throw new Error("Invalid device response");
        const rows = more ? [...state.devices, ...body.devices] : body.devices;
        emit({ devices: [...new Map(rows.map(row => [row.id, row])).values()], nextCursor: body.hasMore ? body.nextCursor : null });
      } catch (error) {
        if (own === generation) emit({ error: error.message || "Devices unavailable" });
      } finally {
        if (own === generation) emit({ loading: false });
      }
    },
    clear() {
      ++generation;
      abort?.abort();
      emit({ devices: [], nextCursor: null, loading: false, error: "" });
    },
    dispose() { ++generation; abort?.abort(); },
  };
}

export function deviceSessionFingerprint(session) {
  const meta = session?.user?.app_metadata;
  return JSON.stringify([session?.user?.id, meta?.organization_id, meta?.app_user_id, meta?.user_type, meta?.role]);
}
export function deviceIdentityChanged(event, previous, session) {
  // Refresh rechecks server authority even when a permission override changed
  // without changing the profile or role encoded in the session.
  return event === "TOKEN_REFRESHED" || previous !== deviceSessionFingerprint(session);
}
