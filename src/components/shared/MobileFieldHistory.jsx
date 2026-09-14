'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/authFetch';
import { supabase } from '@/utils/supabaseClient';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { allowed } from '@/utils/permissions';
import { Button, PageHeader } from '@/components/ui';
const date=()=>new Date().toISOString().slice(0,10);
export default function MobileFieldHistory(){
 const {authStatus}=useAuth();const identity=reportIdentity(getOrgContext());
 const [from,setFrom]=useState(()=>new Date(Date.now()-29*86400000).toISOString().slice(0,10)),[to,setTo]=useState(date),[scope,setScope]=useState('me'),[refresh,setRefresh]=useState(0);
 const [result,setResult]=useState(null),[form,setForm]=useState(null),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const ticket=useRef(0),pending=useRef(false),abort=useRef(null);const binding=`${authStatus}:${identity}:${from}:${to}:${scope}:${refresh}`,live=useRef(binding);live.current=binding;
 const state=result?.binding===binding?result.data:null;
 const current=(captured,generation)=>live.current===captured&&ticket.current===generation&&reportIdentity(getOrgContext())===identity&&allowed('attendance.view_own');
 useEffect(()=>{const {data}=supabase.auth.onAuthStateChange(()=>{++ticket.current;abort.current?.abort();setResult(null);setDetail(null);setForm(null);setRefresh(n=>n+1);});return()=>data?.subscription?.unsubscribe();},[]);
 useEffect(()=>{const versions=ticket,requests=abort;++versions.current;requests.current?.abort();pending.current=false;setBusy(false);setError('');setDetail(null);setForm(null);if(authStatus==='authenticated')void load();return()=>{++versions.current;requests.current?.abort();};
 // Each request carries an identity/filter binding and is invalidated by cleanup.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[binding]);
 async function fetchJson(url,options){const response=await authFetch(url,options);const json=await response.json().catch(()=>({}));if(!response.ok||!json.success)throw new Error(json.error||'Mobile history is unavailable.');return json;}
 async function load(more=false){
  if(pending.current)return;pending.current=true;const captured=binding,generation=++ticket.current,controller=new AbortController();abort.current=controller;const timer=setTimeout(()=>controller.abort(),25000);setBusy(true);setError('');
  try{const context=await fetchJson('/api/mobile/context',{signal:controller.signal});const query=new URLSearchParams({from,to,scope});if(more&&state?.nextCursor)query.set('cursor',state.nextCursor);const page=await fetchJson(`/api/mobile/history?${query}`,{signal:controller.signal});if(!current(captured,generation))return;
   if(!Array.isArray(page.sessions)||!Array.isArray(context.sites))throw new Error('Invalid mobile history response.');const rows=more?[...state.sessions,...page.sessions]:page.sessions;if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('History changed. Refresh the list.');setResult({binding,data:{...context,...page,sessions:rows}});
  }catch(e){if(current(captured,generation)){setError(e.name==='AbortError'?'Request timed out. Retry loading history.':e.message);if(!more)setResult(null);}}
  finally{clearTimeout(timer);if(current(captured,generation)){pending.current=false;setBusy(false);}}
 }
 async function action(kind,row){
  if(pending.current)return;pending.current=true;const captured=binding,generation=++ticket.current,controller=new AbortController();abort.current=controller;const timer=setTimeout(()=>controller.abort(),25000);setBusy(true);setError('');
  try{const json=kind==='detail'?await fetchJson(`/api/mobile/history?id=${row.id}`,{signal:controller.signal}):await fetchJson('/api/mobile/sites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row),signal:controller.signal});if(!current(captured,generation))return;if(kind==='detail')setDetail({binding,session:json.session});else{setForm(null);setRefresh(n=>n+1);}}
  catch(e){if(current(captured,generation))setError(e.name==='AbortError'?'Request timed out. Refresh before retrying.':e.message);}finally{clearTimeout(timer);if(current(captured,generation)){pending.current=false;setBusy(false);}}
 }
 if(authStatus!=='authenticated'||!allowed('attendance.view_own'))return <p>Mobile history access is not available.</p>;
 return <div className="space-y-6"><PageHeader title="Mobile field work" description="Completed Android work sessions, GPS history and work-site geofences." />
 <p className="text-sm">Sessions appear after the employee stops and syncs. Work time enters their timesheet as non-billable, unallocated time and still requires normal approval.</p>
 <div className="flex flex-wrap items-end gap-3">{[['From UTC',from,setFrom],['To UTC',to,setTo]].map(([label,value,set])=><label className="text-sm" key={label}>{label}<input type="date" value={value} onChange={e=>set(e.target.value)} className="block rounded-lg border border-input bg-background p-2" /></label>)}{allowed('monitoring.view')&&allowed('attendance.view_all')&&<label className="text-sm">Show<select className="block rounded-lg border border-input bg-background p-2" value={scope} onChange={e=>setScope(e.target.value)}><option value="me">My sessions</option><option value="all">Organization sessions</option></select></label>}<Button disabled={busy} variant="outline" onClick={()=>load()}>Refresh mobile history</Button></div>
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{busy&&<p role="status">Loading…</p>}
 <section className="space-y-3 rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">Work sites</h2>{state?.sites.map(site=><div key={site.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{site.name} · {site.latitude}, {site.longitude} · {site.radius_m} m · {site.active?'Active':'Inactive'}</span>{state.can_manage&&allowed('attendance.manage')&&<Button variant="outline" disabled={busy} onClick={()=>setForm({...site})}>Edit site</Button>}</div>)}{state?.can_manage&&allowed('attendance.manage')&&<Button disabled={busy} onClick={()=>setForm({id:crypto.randomUUID(),version:0,name:'',latitude:'',longitude:'',radius_m:200,active:true})}>Add work site</Button>}
 {form&&state?.can_manage&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();action('site',form);}}>{['name','latitude','longitude','radius_m'].map(key=><label className="block text-sm" key={key}>{({name:'Site name',latitude:'Latitude',longitude:'Longitude',radius_m:'Radius in metres'})[key]}<input required disabled={busy} type={key==='name'?'text':'number'} step={key==='radius_m'?1:'any'} maxLength={key==='name'?100:undefined} className="block rounded-lg border border-input bg-background p-2" value={form[key]} onChange={e=>setForm({...form,[key]:key==='name'?e.target.value:Number(e.target.value)})}/></label>)}<label className="block text-sm"><input type="checkbox" checked={form.active} disabled={busy} onChange={e=>setForm({...form,active:e.target.checked})}/> Active site</label><Button disabled={busy} type="submit">Save work site</Button><Button disabled={busy} type="button" variant="outline" onClick={()=>setForm(null)}>Close</Button></form>}
 </section>
 <section className="space-y-3"><h2 className="text-lg font-semibold">Recorded sessions</h2>{state?.sessions.map(row=><article key={row.id} className="space-y-2 rounded-xl border border-border p-4 text-sm"><p>{row.started_at} → {row.ended_at}</p><p>{(row.work_seconds/3600).toFixed(2)} work hours · {row.user_type} {row.user_id}</p><Button disabled={busy} variant="outline" onClick={()=>action('detail',row)}>View GPS history</Button></article>)}{state&&!state.sessions.length&&!busy&&<p>No completed sessions in this period.</p>}{state?.nextCursor&&<Button disabled={busy} variant="outline" onClick={()=>load(true)}>More mobile sessions</Button>}</section>
 {detail?.binding===binding&&<section className="space-y-3 rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">GPS history</h2><p className="text-sm">Geofence labels use the current work-site configuration and reported GPS accuracy. They do not prove attendance or change pay. {detail.session.payload.recovered?'This session was recovered at its last saved checkpoint.':''}</p><p className="text-sm">{detail.session.payload.points.length} samples</p><div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>UTC time</th><th>Coordinates</th><th>Accuracy</th><th>Geofence</th></tr></thead><tbody>{detail.session.payload.points.map(point=><tr key={point.at}><td className="p-2">{point.at}</td><td>{point.lat}, {point.lon}</td><td>±{point.accuracy} m{point.mock?' · Mock':''}</td><td>{point.geofence.state}{point.geofence.site?` · ${point.geofence.site}`:''}</td></tr>)}</tbody></table></div><Button variant="outline" onClick={()=>setDetail(null)}>Close GPS history</Button></section>}
 </div>;
}
