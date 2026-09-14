/** Invalidates page requests on identity/range changes; duplicates require reload. */
export function createWorkShiftPager(fetchPage, publish) {
  let generation = 0, abort = null, deadline = null;
  let state = { shifts: [], loading: false, error: '', nextCursor: null, canManage: false, canViewAll: false };
  const emit = update => { state = { ...state, ...update }; publish({ ...state }); };
  return {
    async load(more = false) {
      if (more && (state.loading || !state.nextCursor)) return;
      abort?.abort(); clearTimeout(deadline);
      abort = new AbortController(); const request = abort;
      const own = ++generation, cursor = more ? state.nextCursor : null;
      emit({ loading: true, error: '', ...(more ? {} : { shifts: [], nextCursor: null, canManage: false }) });
      try {
        const timeout = new Promise((_, reject) => { deadline = setTimeout(() => { request.abort(); reject(new Error('Schedule request timed out. Please retry.')); }, 15000); });
        const body = await Promise.race([fetchPage(cursor, request.signal), timeout]);
        if (own !== generation) return;
        if (!Array.isArray(body.shifts) || (body.nextCursor !== null && (typeof body.nextCursor !== 'string' || !body.nextCursor || body.nextCursor === cursor || !body.shifts.length))
            || typeof body.canManage !== 'boolean' || typeof body.canViewAll !== 'boolean') throw new Error('Invalid schedule response. Refresh the list.');
        const rows = more ? [...state.shifts, ...body.shifts] : body.shifts;
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('The schedule changed between pages. Refresh the list.');
        emit({ shifts: rows, nextCursor: body.nextCursor, canManage: body.canManage, canViewAll: body.canViewAll });
      } catch (error) {
        if (own === generation) emit({ error: error.message || 'Schedule unavailable.', canManage: false });
      } finally { if (own === generation) { clearTimeout(deadline); emit({ loading: false }); } }
    },
    clear() { ++generation; abort?.abort(); clearTimeout(deadline); emit({ shifts: [], nextCursor: null, loading: false, error: '', canManage: false, canViewAll: false }); },
    dispose() { ++generation; abort?.abort(); clearTimeout(deadline); },
  };
}
