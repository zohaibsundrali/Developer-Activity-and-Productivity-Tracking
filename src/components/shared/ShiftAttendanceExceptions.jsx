'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/authFetch';
import { supabase } from '@/utils/supabaseClient';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { allowed } from '@/utils/permissions';
import { Button } from '@/components/ui';
const today = () => new Date().toISOString().slice(0,10);
const label = value => ({ late_arrival:'Late arrival', early_departure:'Early departure', missed_shift:'Missed shift', missing_checkout:'Missing checkout', manual_review:'Manual review', approved_leave:'Approved leave', holiday:'Holiday', on_time:'Within grace', unreviewed:'Unreviewed', acknowledged:'Acknowledged', excused:'Excused', reopened:'Reopened', evidence_changed:'Evidence or grace changed — review again' })[value] || value;
export default function ShiftAttendanceExceptions() {
  const { authStatus } = useAuth(), identity = reportIdentity(getOrgContext());
  const [from,setFrom] = useState(() => new Date(Date.now()-6*86400000).toISOString().slice(0,10)), [to,setTo] = useState(today);
  const [scope,setScope] = useState('me'), [late,setLate] = useState(5), [early,setEarly] = useState(5), [refresh,setRefresh] = useState(0);
  const [result,setResult] = useState(null), [form,setForm] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const generation = useRef(0), controller = useRef(null), saving = useRef(false);
  const permissions = JSON.stringify(['attendance.view_own','attendance.view_all','attendance.manage'].map(k=>allowed(k)));
  const binding = `${authStatus}:${identity}:${permissions}:${from}:${to}:${scope}:${late}:${early}:${refresh}`, live = useRef(binding); live.current = binding;
  const current = (captured,ticket) => live.current===captured && generation.current===ticket && reportIdentity(getOrgContext())===identity && allowed(scope==='all'?'attendance.view_all':'attendance.view_own');
  const state = result?.binding===binding ? result.data : null;
  useEffect(()=>{const {data}=supabase.auth.onAuthStateChange(()=>{generation.current++;controller.current?.abort();setResult(null);setForm(null);setRefresh(n=>n+1);});return()=>data?.subscription?.unsubscribe();},[]);
  useEffect(()=>{
    const versions=generation, requests=controller, captured=binding, ticket=++versions.current;
    requests.current?.abort(); const abort=new AbortController();requests.current=abort;saving.current=false;setForm(null);setError('');setBusy(false);
    if(authStatus!=='authenticated'||!identity||!allowed(scope==='all'?'attendance.view_all':'attendance.view_own'))return;
    setBusy(true);const timeout=setTimeout(()=>abort.abort(),20000);
    (async()=>{try{const q=new URLSearchParams({from,to,scope,late,early});const response=await authFetch(`/api/shift-exceptions?${q}`,{signal:abort.signal});const json=await response.json();if(!response.ok||!json.success||!Array.isArray(json.rows))throw new Error(json.error||'Attendance exceptions could not be loaded.');if(current(captured,ticket))setResult({binding:captured,data:json});}catch(e){if(current(captured,ticket))setError(e.name==='AbortError'?'Request timed out. Refresh to retry.':e.message);}finally{clearTimeout(timeout);if(current(captured,ticket))setBusy(false);}})();
    return()=>{versions.current++;abort.abort();clearTimeout(timeout);};
    // Every response is bound to identity, effective access and report inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[binding]);
  async function save(event){
    event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');const captured=binding,ticket=++generation.current,abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),20000);
    try{const response=await authFetch('/api/shift-exceptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form),signal:abort.signal});const json=await response.json();if(!response.ok||!json.success)throw new Error(json.error||'Review could not be saved.');if(current(captured,ticket)){setForm(null);setRefresh(n=>n+1);}}
    catch(e){if(current(captured,ticket))setError(e.name==='AbortError'?'Review timed out. Retry the same form or refresh to check its receipt.':e.message);}
    finally{clearTimeout(timeout);if(current(captured,ticket)){saving.current=false;setBusy(false);}}
  }
  if(authStatus!=='authenticated'||!allowed('attendance.view_own'))return null;
  return <section className="space-y-4 rounded-xl border border-border p-5">
    <h2 className="text-xl font-semibold">Shift attendance exceptions</h2>
    <p className="text-sm">Compare ended, published shifts with attendance check-in/out. Filters use the UTC shift start date; leave coverage uses each shift’s local timezone. GPS and task timers are not attendance clocks.</p>
    <div className="flex flex-wrap items-end gap-3">{[['From UTC',from,setFrom],['To UTC',to,setTo]].map(([text,value,set])=><label className="text-sm" key={text}>{text}<input type="date" value={value} onChange={e=>set(e.target.value)} className="block rounded border border-input bg-background p-2"/></label>)}{[['Late grace (minutes)',late,setLate],['Early grace (minutes)',early,setEarly]].map(([text,value,set])=><label className="text-sm" key={text}>{text}<input type="number" min="0" max="120" value={value} onChange={e=>set(e.target.value===''?'':Number(e.target.value))} className="block w-32 rounded border border-input bg-background p-2"/></label>)}{allowed('attendance.view_all')&&<label className="text-sm">Scope<select value={scope} onChange={e=>setScope(e.target.value)} className="block rounded border border-input bg-background p-2"><option value="me">My shifts</option><option value="all">Organization shifts</option></select></label>}<Button variant="outline" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh exceptions</Button></div>
    <p className="text-sm">Default grace is 5 minutes. These report settings and review decisions do not change attendance, worked hours, leave or pay. Grace changes require reviewing the newly calculated evidence.</p>
    {busy&&<p role="status">Loading…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
    {state&&<p className="text-sm">{state.rows.length} ended shifts · Calculated at {state.as_of}</p>}
    {state?.rows.map(row=><article key={row.snapshot.shift.id} className="space-y-2 rounded-lg border border-border p-4 text-sm">
      <h3 className="font-semibold">{row.snapshot.shift.assignee_name} · {row.snapshot.shift.title}</h3><p>{row.snapshot.shift.start_at} → {row.snapshot.shift.end_at} · {row.snapshot.shift.timezone}</p>
      <p className="font-medium">{row.classification.flags.length?row.classification.flags.map(label).join(' · '):label(row.classification.outcome)} · {label(row.review_state)}</p><p>{row.classification.reason}</p>
      {(row.classification.late_seconds>0||row.classification.early_seconds>0)&&<p>Arrival delay: {(row.classification.late_seconds/60).toFixed(1)} min · Early departure: {(row.classification.early_seconds/60).toFixed(1)} min (full difference from scheduled time)</p>}
      <details><summary className="cursor-pointer">Clock evidence and recent review history</summary>{row.snapshot.attendance.map(a=><p key={a.id}>{a.work_date} · {a.status} · {a.check_in_at||'No check-in'} → {a.check_out_at||'No checkout'}</p>)}{row.snapshot.leave.map(l=><p key={l.id}>Approved leave: {l.start_date} → {l.end_date} · {l.days} days</p>)}{row.reviews.map(r=><p key={r.id}>{r.created_at} · {label(r.decision)} · {r.reason} · {r.actor_type} {r.actor_id}</p>)}<p>Shows up to 20 recent reviews. Earlier reviews remain in the audit records.</p></details>
      {state.can_manage&&allowed('attendance.manage')&&allowed('attendance.view_all')&&<Button disabled={busy} variant="outline" onClick={()=>setForm({id:crypto.randomUUID(),shiftId:row.snapshot.shift.id,fingerprint:row.fingerprint,late,early,decision:'acknowledged',reason:''})}>Review exception</Button>}
    </article>)}
    {state&&!state.rows.length&&<p>No ended published shifts in this period.</p>}
    {form&&state?.can_manage&&allowed('attendance.manage')&&allowed('attendance.view_all')&&<form onSubmit={save} className="space-y-3 rounded-lg border border-border p-4"><h3 className="font-semibold">Record review</h3><p className="text-sm">Reviews do not edit clock records. Resolve incorrect attendance evidence before excusing the exception, then refresh.</p><select aria-label="Review decision" value={form.decision} disabled={busy} onChange={e=>setForm({...form,decision:e.target.value})} className="rounded border border-input bg-background p-2">{['acknowledged','excused','reopened'].map(d=><option key={d} value={d}>{label(d)}</option>)}</select><textarea aria-label="Review reason" required maxLength={1000} value={form.reason} disabled={busy} onChange={e=>setForm({...form,reason:e.target.value})} className="block w-full rounded border border-input bg-background p-2"/><Button disabled={busy} type="submit">Save review</Button><Button disabled={busy} variant="outline" type="button" onClick={()=>setForm(null)}>Cancel review</Button></form>}
  </section>;
}
