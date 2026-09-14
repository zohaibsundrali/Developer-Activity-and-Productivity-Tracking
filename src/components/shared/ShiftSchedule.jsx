'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/authFetch';
import { getOrgContext } from '@/utils/orgContext';
import { allowed } from '@/utils/permissions';
import { supabase } from '@/utils/supabaseClient';
import { reportIdentity } from '@/utils/reportViewState';
import { createWorkShiftPager } from '@/utils/workShiftPager';
import { resolveLocalShiftTime, localShiftValue, validShiftRow, validateShiftInput, SHIFT_UUID } from '@/utils/workShifts';
import { Button, PageHeader, ErrorState } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);
const dateAfter = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const blankForm = () => ({ id: crypto.randomUUID(), version: 0, person: '', name: '', title: '', start: '', end: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', startOccurrence: 'reject', endOccurrence: 'reject', status: 'draft', note: '' });
const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm';
const empty = { shifts: [], loading: true, error: '', nextCursor: null, canManage: false, canViewAll: false };

export default function ShiftSchedule() {
  const { authStatus } = useAuth();
  const identity = reportIdentity(getOrgContext());
  const organization = getOrgContext()?.organizationId;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => dateAfter(today(), 6));
  const [scope, setScope] = useState('me');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState([]);
  const [staffCursor, setStaffCursor] = useState(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const pager = useRef(null), action = useRef(0), saving = useRef(false), staffGeneration = useRef(0), staffSearch = useRef('');
  const binding = `${authStatus}:${identity}:${from}:${to}:${scope}:${refresh}`;
  const live = useRef(binding); live.current = binding;
  const current = captured => live.current === captured && reportIdentity(getOrgContext()) === identity && allowed('attendance.view_own');
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => { ++action.current; ++staffGeneration.current; setResult(null); setForm(null); setRefresh(value => value + 1); });
    return () => data?.subscription?.unsubscribe();
  }, []);
  useEffect(() => {
    const actionVersion = action, rosterVersion = staffGeneration;
    ++actionVersion.current; ++rosterVersion.current; saving.current = false;
    setBusy(false); setStaffBusy(false); setForm(null); setStaff([]); setStaffCursor(null); setError(''); setMessage('');
    if (authStatus !== 'authenticated' || !identity) return;
    const controller = createWorkShiftPager(async (cursor, signal) => {
      const q = new URLSearchParams({ from, to, scope }); if (cursor) q.set('cursor', cursor);
      const response = await authFetch(`/api/shifts?${q}`, { signal });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) throw new Error(json.error || 'The schedule could not be loaded.');
      if (!Array.isArray(json.shifts) || json.shifts.some(row => !validShiftRow(row, organization))) throw new Error('Invalid schedule response.');
      return json;
    }, state => { if (live.current === binding) setResult({ binding, state }); });
    pager.current = controller; controller.load();
    return () => { controller.dispose(); ++actionVersion.current; ++rosterVersion.current; };
  }, [authStatus, identity, organization, from, to, scope, refresh, binding]);
  const state = result?.binding === binding ? result.state : empty;
  const canManage = state.canManage && allowed('attendance.manage') && allowed('attendance.view_all');
  function field(name, value) { setForm(previous => ({ ...previous, [name]: value })); setError(''); setMessage(''); }
  async function loadStaff(more = false) {
    if (!canManage || staffBusy || (more && !staffCursor)) return;
    const captured = binding, ticket = ++staffGeneration.current;
    setStaffBusy(true); setError('');
    if (!more) { staffSearch.current = search; setStaff([]); setStaffCursor(null); }
    const q = new URLSearchParams({ view: 'staff', search: staffSearch.current }); if (more) q.set('cursor', staffCursor);
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await authFetch(`/api/shifts?${q}`, { signal: abort.signal });
      const json = await response.json().catch(() => ({}));
      if (!current(captured) || ticket !== staffGeneration.current) return;
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not load staff.');
      if (!Array.isArray(json.staff) || json.staff.some(row => !SHIFT_UUID.test(row?.id || '') || !['admin', 'developer'].includes(row.user_type) || typeof row.name !== 'string')
          || (json.nextCursor !== null && (typeof json.nextCursor !== 'string' || json.nextCursor === staffCursor))) throw new Error('Staff list changed. Search again.');
      const rows = more ? [...staff, ...json.staff] : json.staff;
      if (new Set(rows.map(row => `${row.user_type}:${row.id}`)).size !== rows.length) throw new Error('Staff list changed. Search again.');
      setStaff(rows); setStaffCursor(json.nextCursor);
    } catch (e) { if (current(captured) && ticket === staffGeneration.current) setError(e.name === 'AbortError' ? 'Staff search timed out. Retry the search.' : e.message); }
    finally { clearTimeout(timer); if (live.current === captured && ticket === staffGeneration.current) setStaffBusy(false); }
  }
  function edit(row) {
    if (!canManage || row.status === 'cancelled') return;
    const occurrence = instant => {
      const local = localShiftValue(instant, row.timezone);
      return resolveLocalShiftTime(local, row.timezone, 'earlier') === new Date(instant).toISOString() ? 'earlier' : 'later';
    };
    setForm({ id: row.id, version: row.version, person: `${row.user_type}:${row.user_id}`, name: row.assignee_name,
      title: row.title, start: localShiftValue(row.start_at, row.timezone), end: localShiftValue(row.end_at, row.timezone),
      timezone: row.timezone, startOccurrence: occurrence(row.start_at), endOccurrence: occurrence(row.end_at), status: row.status, note: row.note });
    setError(''); setMessage('');
  }
  async function save(event, cancellation = null) {
    event?.preventDefault();
    if (!canManage || saving.current) return;
    const captured = binding, ticket = ++action.current;
    let input;
    try {
      if (cancellation) input = { id: cancellation.id, version: cancellation.version, userId: cancellation.user_id, userType: cancellation.user_type, start: cancellation.start_at, end: cancellation.end_at, timezone: cancellation.timezone, title: cancellation.title, status: 'cancelled', note: cancellation.note };
      else {
        const [userType, userId] = form.person.split(':');
        input = { id: form.id, version: form.version, userId, userType, start: resolveLocalShiftTime(form.start, form.timezone, form.startOccurrence),
          end: resolveLocalShiftTime(form.end, form.timezone, form.endOccurrence), timezone: form.timezone, title: form.title, status: form.status, note: form.note };
      }
      input = validateShiftInput(input);
    } catch (e) { setError(e.message); return; }
    saving.current = true; setBusy(true); setError(''); setMessage('');
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await authFetch('/api/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: abort.signal });
      const json = await response.json().catch(() => ({}));
      if (!current(captured) || ticket !== action.current) return;
      if (!response.ok || !json.success || !validShiftRow(json.shift, organization)) throw new Error(json.error || 'The schedule change could not be confirmed. Refresh before retrying.');
      setForm(null); setMessage(input.status === 'cancelled' ? 'Shift cancelled. Its history is retained.' : 'Shift saved. Published shifts appear in the employee’s schedule.');
      pager.current?.load();
    } catch (e) { if (current(captured) && ticket === action.current) setError(e.name === 'AbortError' ? 'The save result is uncertain. Retry the same request or refresh the schedule before making another shift.' : e.message); }
    finally { clearTimeout(timer); if (live.current === captured && ticket === action.current) { saving.current = false; setBusy(false); } }
  }
  if (authStatus !== 'authenticated') return <p role="status">Sign in to view your schedule.</p>;
  if (!allowed('attendance.view_own')) return <ErrorState title="Schedule access is not allowed" description="Your attendance permissions do not include this view." />;
  return <div className="space-y-6">
    <PageHeader title="Shift schedule" description="Plan shifts in the employee’s timezone. Scheduled hours are separate from recorded attendance and approved work time." />
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
      <label className="text-sm">From (UTC date)<input aria-label="Schedule from date" type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="text-sm">To (UTC date)<input aria-label="Schedule to date" type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></label>
      {allowed('attendance.view_all') && <label className="text-sm">Show<select aria-label="Schedule scope" className={inputClass} value={scope} onChange={e => setScope(e.target.value)}><option value="me">My shifts</option><option value="all">Organization shifts</option></select></label>}
      <Button type="button" variant="outline" disabled={state.loading || busy} onClick={() => pager.current?.load()}>Refresh schedule</Button>
      {canManage && <Button type="button" disabled={busy} onClick={() => { setForm(blankForm()); setError(''); setMessage(''); }}>New shift</Button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {form && canManage && <form onSubmit={save} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{form.version ? 'Edit shift' : 'New shift'}</h2>
      <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Find staff<input aria-label="Find shift staff" className={inputClass} value={search} maxLength={100} onChange={e => setSearch(e.target.value)} disabled={busy} /></label><Button type="button" variant="outline" disabled={staffBusy || busy} onClick={() => loadStaff()}>Search staff</Button>{staffCursor && <Button type="button" variant="outline" disabled={staffBusy || busy || search !== staffSearch.current} onClick={() => loadStaff(true)}>More staff</Button>}</div>
      <label className="block text-sm">Staff member<select aria-label="Shift staff member" required className={inputClass} value={form.person} disabled={busy} onChange={e => { const person = staff.find(p => `${p.user_type}:${p.id}` === e.target.value); setForm(previous => ({ ...previous, person: e.target.value, name: person?.name || '' })); }}>
        <option value="">Search and choose a staff member</option>
        {form.person && !staff.some(p => `${p.user_type}:${p.id}` === form.person) && <option value={form.person}>{form.name}</option>}
        {staff.map(p => <option key={`${p.user_type}:${p.id}`} value={`${p.user_type}:${p.id}`}>{p.name} ({p.user_type})</option>)}
      </select></label>
      <label className="block text-sm">Shift title<input aria-label="Shift title" required maxLength={120} className={inputClass} value={form.title} disabled={busy} onChange={e => field('title', e.target.value)} /></label>
      <label className="block text-sm">Timezone<input aria-label="Shift timezone" required maxLength={64} className={inputClass} value={form.timezone} disabled={busy} onChange={e => field('timezone', e.target.value)} placeholder="Asia/Karachi" /></label>
      <div className="grid gap-4 sm:grid-cols-2">{['start', 'end'].map(which => <div key={which} className="space-y-2">
        <label className="block text-sm">{which === 'start' ? 'Start' : 'End'} in selected timezone<input aria-label={`Shift ${which}`} type="datetime-local" required className={inputClass} value={form[which]} disabled={busy} onChange={e => field(which, e.target.value)} /></label>
        <label className="block text-xs text-muted-foreground">If the clock repeats this time<select aria-label={`${which} repeated time`} className={inputClass} value={form[`${which}Occurrence`]} disabled={busy} onChange={e => field(`${which}Occurrence`, e.target.value)}><option value="reject">Ask me to choose</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>
      </div>)}</div>
      <label className="block text-sm">Visibility<select aria-label="Shift status" className={inputClass} value={form.status} disabled={busy} onChange={e => field('status', e.target.value)}><option value="draft">Draft — managers only</option><option value="published">Published — visible to employee</option></select></label>
      <label className="block text-sm">Note for the employee<textarea aria-label="Shift note" maxLength={1000} className={inputClass} value={form.note} disabled={busy} onChange={e => field('note', e.target.value)} /></label>
      <div className="flex gap-3"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save shift'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Close editor</Button></div>
    </form>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.loading && <p role="status">Loading schedule…</p>}
    {!state.loading && !state.error && !state.shifts.length && <p>No shifts overlap the selected period.</p>}
    <div className="space-y-3">{state.shifts.map(row => <article key={row.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{row.title} · {row.assignee_name}</h2><span className="text-sm capitalize">{row.status}</span></div>
      <p className="text-sm">{localShiftValue(row.start_at, row.timezone).replace('T', ' ')} → {localShiftValue(row.end_at, row.timezone).replace('T', ' ')} ({row.timezone})</p>
      <p className="text-xs text-muted-foreground">{((Date.parse(row.end_at) - Date.parse(row.start_at)) / 3600000).toFixed(2)} scheduled hours</p>
      {row.note && <p className="whitespace-pre-wrap text-sm">{row.note}</p>}
      {canManage && row.status !== 'cancelled' && <div className="flex gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => edit(row)}>Edit shift</Button><Button type="button" variant="outline" disabled={busy} onClick={event => save(event, row)}>Cancel shift</Button></div>}
    </article>)}</div>
    {state.nextCursor && <Button type="button" variant="outline" disabled={state.loading || busy} onClick={() => pager.current?.load(true)}>Load more shifts</Button>}
  </div>;
}
