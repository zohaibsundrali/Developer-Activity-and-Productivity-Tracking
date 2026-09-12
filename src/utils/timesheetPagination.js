// Request ownership prevents stale refreshes, account changes and unmounts from
// appending a previous identity's timesheets. Failed pages keep the visible list.
export function createTimesheetPager(fetchPage, publish) {
  let generation = 0;
  let abort = null;
  let state = { timesheets: [], loading: false, error: "", retryMore: false, nextCursor: null };
  const emit = update => { state = { ...state, ...update }; publish({ ...state }); };
  return {
    async load(more = false) {
      if (more && (state.loading || !state.nextCursor)) return;
      abort?.abort();
      abort = new AbortController();
      const own = ++generation;
      const cursor = more ? state.nextCursor : null;
      emit({ loading: true, error: "", retryMore: false });
      try {
        const body = await fetchPage(cursor, abort.signal);
        if (own !== generation) return;
        if (!Array.isArray(body.timesheets) || typeof body.hasMore !== "boolean" || (body.hasMore && (!body.timesheets.length || typeof body.nextCursor !== "string" || !body.nextCursor || body.nextCursor === cursor))) throw new Error("Invalid timesheet response");
        const rows = more ? [...state.timesheets, ...body.timesheets] : body.timesheets;
        emit({ timesheets: [...new Map(rows.map(row => [row.id, row])).values()], nextCursor: body.hasMore ? body.nextCursor : null });
      } catch (error) {
        if (own === generation) emit({ error: error.message || "Timesheets unavailable", retryMore: more });
      } finally {
        if (own === generation) emit({ loading: false });
      }
    },
    clear() {
      ++generation;
      abort?.abort();
      emit({ timesheets: [], nextCursor: null, loading: false, error: "", retryMore: false });
    },
    dispose() { ++generation; abort?.abort(); },
  };
}

