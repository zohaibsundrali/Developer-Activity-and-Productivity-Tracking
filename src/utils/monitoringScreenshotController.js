import { validReportDate } from "@/utils/reportDates";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 24;
const empty = () => ({ rows: [], total: null, page: 1, loading: false, error: '', hasNext: false, hasPrevious: false });
const invalid = () => new Error('Could not confirm the screenshot page. Please retry.');

// Postgres cursor timestamps retain microseconds, beyond Date.parse precision.
function instant(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})$/i);
  if (!match || !validReportDate(value.slice(0, 10))) return null;
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms)) return null;
  const remaining = (match[1] || '').padEnd(6, '0').slice(3);
  return BigInt(ms) * 1000n + BigInt(remaining);
}

export function validateScreenshotPage(data, { organizationId, profileId, start, end, cursor }) {
  const startTime = instant(start), endTime = instant(end);
  if (startTime === null || endTime === null || startTime >= endTime) throw invalid();
  if (!data || !Array.isArray(data.rows) || data.rows.length > PAGE_SIZE
    || !Number.isSafeInteger(data.total) || data.total < data.rows.length || data.total < 0
    || !Object.hasOwn(data, 'next_cursor')) throw invalid();
  const seen = new Set();
  let previous = cursor;
  for (const row of data.rows) {
    const time = instant(row?.captured_at);
    if (!UUID.test(row?.id || '') || seen.has(row.id) || row.organization_id !== organizationId || row.developer_id !== profileId
      || time === null || time < startTime || time >= endTime
      || (previous && (instant(previous.time) === null || time > instant(previous.time) || (time === instant(previous.time) && row.id >= previous.id)))) throw invalid();
    seen.add(row.id);
    previous = { time: row.captured_at, id: row.id };
  }
  const next = data.next_cursor;
  if (next !== null && (!next || !UUID.test(next.id || '') || data.rows.length !== PAGE_SIZE
    || next.id !== previous?.id || instant(next.time) === null || instant(next.time) !== instant(previous?.time))) throw invalid();
  if (!cursor && (data.rows.length !== Math.min(PAGE_SIZE, data.total) || (next !== null) !== (data.total > data.rows.length))) throw invalid();
  return data;
}

/** Framework-free lifecycle: one scoped cursor history, with independently guarded signing. */
export function createMonitoringScreenshotController({ client, organizationId, profileId, start, end, makeGuard, sign, onChange = () => {} }) {
  const guard = makeGuard();
  let disposed = false;
  let generation = 0;
  let signing = 0;
  let history = [null];
  let index = 0;
  let nextCursor = null;
  let state = empty();
  const current = ticket => !disposed && guard.current() && (ticket === undefined || ticket === generation);
  const publish = patch => { state = { ...state, ...patch }; if (current()) onChange(state); };
  async function signedRows(rows) {
    let resolved = [];
    try { resolved = await sign(rows); } catch { /* Metadata stays visible when Storage is unavailable. */ }
    return rows.map((row, i) => ({ ...row, image_url: null, thumbnail_url: null, publicUrl: null,
      public_url: Array.isArray(resolved) && resolved[i]?.id === row.id && typeof resolved[i].public_url === 'string' ? resolved[i].public_url : null }));
  }
  async function load(navigating = false) {
    if (!current()) return;
    const ticket = ++generation;
    ++signing;
    publish({ loading: true, error: '', page: index + 1, hasPrevious: index > 0,
      ...(navigating ? { rows: [], total: null, hasNext: false } : {}) });
    const cursor = history[index];
    try {
      const { data, error } = await client.rpc('monitoring_screenshot_page', {
        p_organization_id: organizationId, p_developer_id: profileId, p_start: start, p_end: end,
        p_cursor_time: cursor?.time ?? null, p_cursor_id: cursor?.id ?? null, p_limit: PAGE_SIZE,
      });
      if (!current(ticket)) return;
      if (error) throw new Error('Could not load screenshots. Check your access and retry.');
      validateScreenshotPage(data, { organizationId, profileId, start, end, cursor });
      if (data.rows.some(row => !guard.accepts(row))) throw invalid();
      if (index > 0 && data.rows.length === 0) {
        history = [null]; index = 0; nextCursor = null;
        return load(true);
      }
      const rows = await signedRows(data.rows);
      if (!current(ticket)) return;
      nextCursor = data.next_cursor;
      publish({ rows, total: data.total, loading: false, error: '', page: index + 1,
        hasNext: nextCursor !== null, hasPrevious: index > 0 });
    } catch (error) {
      if (current(ticket)) publish({ rows: [], total: null, loading: false, error: error?.message || 'Could not load screenshots.', hasNext: false });
    }
  }
  async function retryImages() {
    if (!current() || state.loading || !state.rows.length) return;
    const ticket = generation, signTicket = ++signing;
    const rows = await signedRows(state.rows);
    if (current(ticket) && signTicket === signing) publish({ rows });
  }
  return {
    getState: () => state,
    refresh: () => load(),
    next() {
      if (!current() || state.loading || !nextCursor || !state.hasNext) return;
      history = [...history.slice(0, index + 1), nextCursor]; index += 1;
      return load(true);
    },
    previous() {
      if (!current() || state.loading || index === 0) return;
      index -= 1;
      return load(true);
    },
    retryImages,
    dispose() { disposed = true; ++generation; ++signing; guard.dispose(); },
  };
}

export function attachScreenshotRenewal({ renew, windowTarget, documentTarget, setTimer = setInterval, clearTimer = clearInterval }) {
  const visibleRenew = () => { if (documentTarget.visibilityState !== 'hidden') renew(); };
  const timer = setTimer(visibleRenew, 8 * 60 * 1000);
  windowTarget.addEventListener('focus', visibleRenew);
  documentTarget.addEventListener('visibilitychange', visibleRenew);
  return () => {
    clearTimer(timer);
    windowTarget.removeEventListener('focus', visibleRenew);
    documentTarget.removeEventListener('visibilitychange', visibleRenew);
  };
}
