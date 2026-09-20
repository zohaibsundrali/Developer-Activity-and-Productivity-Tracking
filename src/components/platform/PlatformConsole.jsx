'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, ArrowUpRight, Building2, Check, ChevronLeft, ChevronRight, CreditCard, FolderKanban, LayoutDashboard, Loader2, LogOut, Moon, RefreshCw, Search, ShieldCheck, Sun, Trash2, Users, X } from 'lucide-react';
import { authFetch } from '@/utils/authFetch';
import { logoutAndRedirect } from '@/utils/browserLogout';
import { BrandLockup } from '@/components/auth/AuthShell';
import AuthLoadingScreen from '@/components/auth/AuthLoadingScreen';
import styles from './PlatformConsole.module.css';

const nav = [{ id:'overview', label:'Overview', icon:LayoutDashboard },{ id:'organizations', label:'Organizations', icon:Building2 },{ id:'billing', label:'Billing', icon:CreditCard },{ id:'activity', label:'Activity & cleanup', icon:Activity }];
const number = value => new Intl.NumberFormat('en').format(value ?? 0);
const date = value => value ? new Date(value).toLocaleDateString('en', {day:'numeric',month:'short',year:'numeric'}) : '—';
const money = (cents, currency='USD') => { try { return new Intl.NumberFormat('en',{style:'currency',currency}).format((cents || 0)/100); } catch { return `${number((cents || 0)/100)} ${currency}`; } };
async function request(path, options) {
  const res = await authFetch(`/api/platform/${path}`, { cache:'no-store', ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed. Please retry.'),{status:res.status});
  return data;
}
function useData(path, refresh=0) {
  const [state,setState]=useState({loading:true,data:null,error:null});
  useEffect(()=>{
    if (path === null) return;
    let active=true; const controller=new AbortController();
    setState({loading:true,data:null,error:null});
    request(path,{signal:controller.signal}).then(data=>{if(active)setState({loading:false,data,error:null});}).catch(error=>{if(active)setState({loading:false,data:null,error});});
    return ()=>{active=false;controller.abort();};
  },[path,refresh]);
  return state;
}
function Badge({children}) { return <span className={styles.badge} data-tone={['active','paid','completed'].includes(children)?'good':['past_due','unpaid','retry','suspended'].includes(children)?'warning':'neutral'}>{String(children || 'Not recorded').replaceAll('_',' ')}</span>; }
function Empty({children='No records to show yet.'}) { return <div className={styles.empty}>{children}</div>; }
function State({state,children}) {
  if(state.loading)return <div role="status" className={styles.empty}><Loader2 className="animate-spin motion-reduce:animate-none" size={22}/>Loading records…</div>;
  if(state.error)return <div role="alert" className={styles.error}>{state.error.message}</div>;
  return children(state.data);
}
function Pagination({data,page,setPage}) { const pages=Math.max(1,Math.ceil(data.total/data.pageSize));return <div className={styles.pagination}><span>{number(data.total)} records · Page {page} of {pages}</span><div><button aria-label="Previous page" disabled={page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><button aria-label="Next page" disabled={page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button></div></div>; }
function Metric({label,value,note,icon:Icon}) {return <article className={styles.metric}><div><span>{label}</span>{Icon&&<Icon size={18}/>}</div><strong>{number(value)}</strong><small>{note}</small></article>;}
function Table({headers,children}) {return <div className={styles.tableWrap}><table><thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}

export default function PlatformConsole() {
  const [access,setAccess]=useState({loading:true,data:null,error:null});
  const [section,setSection]=useState('overview'); const [selected,setSelected]=useState(null);
  const [refresh,setRefresh]=useState(0); const [dark,setDark]=useState(false);
  useEffect(()=>{setDark(document.documentElement.classList.contains('dark'));},[]);
  const verify=useCallback(()=>{setAccess({loading:true,data:null,error:null});request('access').then(data=>setAccess({loading:false,data,error:null})).catch(error=>setAccess({loading:false,data:null,error}));},[]);
  useEffect(()=>{verify();},[verify]);
  function theme(){const next=!dark;setDark(next);document.documentElement.classList.toggle('dark',next);document.documentElement.style.colorScheme=next?'dark':'light';localStorage.setItem('devtrack.theme',next?'dark':'light');}
  if(access.loading)return <AuthLoadingScreen message="Opening platform console…"/>;
  if(access.error)return <div className={styles.gate}><BrandLockup/><ShieldCheck size={36}/><h1>Platform owner access</h1><p role="alert">{access.error.message}</p><div><Link href="/login">Sign in</Link><button onClick={verify}>Try again</button><Link href="/organizations">Your organizations</Link></div></div>;
  const open=id=>{setSelected(id);setSection('organizations');};
  return <div className={styles.console}>
    <aside className={styles.sidebar}><Link href="/admin" aria-label="Verisade platform home"><BrandLockup/></Link><span className={styles.workspaceLabel}>PLATFORM WORKSPACE</span><nav aria-label="Platform navigation">{nav.map(({id,label,icon:Icon})=><button key={id} aria-current={section===id?'page':undefined} onClick={()=>{setSelected(null);setSection(id);}}><Icon size={19}/>{label}{section===id&&<span className={styles.activeDot}/>}</button>)}</nav><div className={styles.sidebarBottom}><div className={styles.ownerMark}><ShieldCheck size={20}/><div><strong>Platform owner</strong><span>Verisade administration</span></div></div><Link href="/organizations">Open your workspaces <ArrowUpRight size={16}/></Link></div></aside>
    <div className={styles.workspace}><header className={styles.topbar}><div><span className={styles.liveDot}/><span>Verisade control center</span></div><div><span className={styles.email}>{access.data.email}</span><button onClick={theme} aria-label={dark?'Use light theme':'Use dark theme'}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button onClick={()=>logoutAndRedirect()} aria-label="Sign out"><LogOut size={18}/></button></div></header>
    <main className={styles.main}><div className={styles.pageHeading}><div><p className={styles.eyebrow}>YOUR PLATFORM, AT A GLANCE</p><h1>{selected?'Organization details':nav.find(n=>n.id===section)?.label}</h1><p>{section==='overview'?'A clear view of your organizations, people and business.':section==='organizations'?'Explore every workspace and manage its lifecycle.':section==='billing'?'Subscription records and payments across your platform.':'An accountable record of platform actions and cleanup jobs.'}</p></div><button className={styles.button} onClick={()=>setRefresh(x=>x+1)}><RefreshCw size={16}/>Refresh</button></div>
    {section==='overview'&&<Overview refresh={refresh} onExplore={()=>setSection('organizations')}/>}
    {section==='organizations'&&(selected?<Organization key={selected} id={selected} refresh={refresh} back={()=>setSelected(null)} onRefresh={()=>setRefresh(x=>x+1)}/>:<Organizations refresh={refresh} open={open}/>)}
    {section==='billing'&&<Billing refresh={refresh} open={open}/>}
    {section==='activity'&&<ActivityPanel refresh={refresh} onRefresh={()=>setRefresh(x=>x+1)} open={open}/>}
    <footer className={styles.footer}><span>© {new Date().getFullYear()} Verisade</span><span><ShieldCheck size={14}/>Restricted to platform owners</span></footer></main></div>
  </div>;
}
function Overview({refresh,onExplore}) {
  const state=useData('overview',refresh);
  return <State state={state}>{data=><>
    <section className={styles.hero}><div><span className={styles.heroTag}><span className={styles.liveDot}/> PLATFORM SNAPSHOT</span><h2>Every workspace.<br/>One clear picture.</h2><p>Your operational data, together in one place.</p><button onClick={onExplore}>Explore organizations <ArrowUpRight size={17}/></button></div><div className={styles.heroNumber}><span>Organizations on Verisade</span><strong>{number(data.organizations)}</strong><small>Updated {new Date(data.generatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div></section>
    <section className={styles.metrics} aria-label="Platform totals"><Metric label="Organizations" value={data.organizations} note="All workspaces" icon={Building2}/><Metric label="Projects" value={data.projects} note="Across all organizations" icon={FolderKanban}/><Metric label="Active memberships" value={data.memberships} note="Workspace seats, not unique people" icon={Users}/><Metric label="Tasks" value={data.tasks} note="All recorded tasks" icon={Check}/></section>
    <div className={styles.twoColumns}><section className={styles.panel}><div className={styles.panelHeading}><div><h2>Workspace growth</h2><p>Organizations created · last six months</p></div><Badge>Monthly</Badge></div><div className={styles.chart} role="img" aria-label={data.growth.map(x=>`${x.month}: ${x.organizations} organizations`).join(', ')}>{data.growth.map(x=><div key={x.month} className={styles.chartColumn}><span>{x.organizations}</span><div className={styles.barTrack}><div className={styles.bar} style={{height:`${Math.max(2,x.organizations/Math.max(1,...data.growth.map(v=>v.organizations))*100)}%`}}/></div><small>{new Date(`${x.month}-01T00:00:00`).toLocaleDateString('en',{month:'short'})}</small></div>)}</div></section>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Billing pulse</h2><p>Recorded invoice payments, grouped by currency</p></div><CreditCard size={20}/></div>{data.revenue.length?data.revenue.map(x=><div key={x.currency} className={styles.revenue}><span>{x.currency} collected · all time</span><strong>{money(x.paid_cents,x.currency)}</strong></div>):<Empty>No paid invoices recorded yet.</Empty>}<div className={styles.statusList}>{data.subscriptions.map(x=><div key={x.status}><Badge>{x.status}</Badge><strong>{number(x.count)}</strong></div>)}</div><p className={styles.caption}>Subscription records represent billing accounts. Shared workspaces may use one subscription.</p></section></div>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>People & operations</h2><p>Current profile and tracking inventory</p></div></div><div className={styles.operations}>{[['Admin profiles',data.admins],['Staff profiles',data.developers],['Client profiles',data.clients],['Tracker devices',data.devices],['Screenshots',data.screenshots],['Pending cleanups',data.deletionsPending]].map(([label,value])=><div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}</div></section>
  </>}</State>;
}
function Organizations({refresh,open}) {
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const state=useData(`organizations?q=${encodeURIComponent(search)}&page=${page}`,refresh);
  return <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Organization directory</h2><p>Search by name or organization ID</p></div><form className={styles.search} onSubmit={e=>{e.preventDefault();setPage(1);setSearch(query);}}><Search size={17}/><input aria-label="Search organizations" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find an organization…" maxLength={100}/><button type="submit">Search</button></form></div><State state={state}>{data=><>{data.items.length?<Table headers={['Organization','Projects','Active members','Tasks','Created','']} >{data.items.map(o=><tr key={o.id}><td><button className={styles.nameButton} onClick={()=>open(o.id)}><span className={styles.orgIcon}><Building2 size={18}/></span><span><strong>{o.name}</strong><small>{[o.industry,o.country].filter(Boolean).join(' · ')||'Workspace'} {o.deletion_status&&`· ${o.deletion_status}`}</small></span></button></td><td>{number(o.projects)}</td><td>{number(o.members)}</td><td>{number(o.tasks)}</td><td>{date(o.created_at)}</td><td><button aria-label={`View ${o.name}`} onClick={()=>open(o.id)}><ArrowUpRight size={18}/></button></td></tr>)}</Table>:<Empty>No organizations match this search.</Empty>}<Pagination data={data} page={page} setPage={setPage}/></>}</State></section>;
}
function Billing({refresh,open}) {
  const [tab,setTab]=useState('subscriptions'),[page,setPage]=useState(1);
  const state=useData(`billing?tab=${tab}&page=${page}`,refresh);
  return <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Billing records</h2><p>Synced billing history · shared accounts appear once</p></div><div className={styles.tabs}>{['subscriptions','invoices'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setPage(1);}}>{t}</button>)}</div></div><State state={state}>{data=><>{data.items.length?<Table headers={tab==='subscriptions'?['Organization','Plan','Status','Renewal / period end','Cancellation']:['Organization','Status','Paid','Due','Recorded']}>{data.items.map(row=><tr key={row.id}><td><button className={styles.textButton} onClick={()=>open(row.organization_id)}>{row.organizations?.name||row.organization_id}</button></td>{tab==='subscriptions'?<><td>{row.plan_code}</td><td><Badge>{row.status}</Badge></td><td>{date(row.current_period_end)}</td><td>{row.cancel_at_period_end?'At period end':'Not scheduled'}</td></>:<><td><Badge>{row.status}</Badge></td><td>{money(row.amount_paid_cents,row.currency)}</td><td>{money(row.amount_due_cents,row.currency)}</td><td>{date(row.created_at)}</td></>}</tr>)}</Table>:<Empty>No billing records yet.</Empty>}<Pagination data={data} page={page} setPage={setPage}/></>}</State></section>;
}
function Organization({id,refresh,back,onRefresh}) {
  const state=useData(`organizations/${id}`,refresh);
  const [tab,setTab]=useState('projects'),[page,setPage]=useState(1),[confirm,setConfirm]=useState(false);
  const records=useData(state.data?`organizations/${id}?tab=${tab}&page=${page}`:null,refresh);
  return <><button className={styles.back} onClick={back}><ArrowLeft size={16}/>All organizations</button><State state={state}>{data=><>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>{data.organization.name}</h2><p>{data.organization.id}</p></div><Badge>{data.deletion?.status||'Workspace'}</Badge></div><div className={styles.organizationMeta}>{[['Industry',data.organization.industry],['Country',data.organization.country],['Timezone',data.organization.timezone],['Created',date(data.organization.created_at)]].map(([k,v])=><div key={k}><span>{k}</span><strong>{v||'—'}</strong></div>)}</div></section>
    <div className={styles.metrics}>{Object.entries(data.stats).map(([k,v])=><Metric key={k} label={k} value={v} note="In this workspace"/>)}</div>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Subscription</h2><p>{data.billingOrganizationId!==id?'Shared billing account':'Workspace billing account'}</p></div><Badge>{data.subscription?.status||'No subscription record'}</Badge></div><div className={styles.organizationMeta}><div><span>Plan</span><strong>{data.subscription?.plan_code||'Not recorded'}</strong></div><div><span>Period end</span><strong>{date(data.subscription?.current_period_end)}</strong></div><div><span>Trial end</span><strong>{date(data.subscription?.trial_end)}</strong></div><div><span>Last payment</span><strong>{data.subscription?.last_payment_status||'Not recorded'}</strong></div></div></section>
    <section className={styles.panel}><div className={styles.panelHeading}><h2>Workspace records</h2><div className={styles.tabs}>{['projects','members','invoices'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setPage(1);}}>{t}</button>)}</div></div><State state={records}>{r=><>{r.items.length?<Table headers={tab==='projects'?['Project','Status','Created']:tab==='members'?['Email','Role','Status']:['Status','Paid','Due','Date']}>{r.items.map(row=><tr key={row.id}>{tab==='projects'?<><td>{row.name}</td><td><Badge>{row.status}</Badge></td><td>{date(row.created_at)}</td></>:tab==='members'?<><td>{row.email||'No email recorded'}</td><td>{row.role}</td><td><Badge>{row.status}</Badge></td></>:<><td><Badge>{row.status}</Badge></td><td>{money(row.amount_paid_cents,row.currency)}</td><td>{money(row.amount_due_cents,row.currency)}</td><td>{date(row.issued_at||row.created_at)}</td></>}</tr>)}</Table>:<Empty>No {tab} recorded.</Empty>}<Pagination data={r} page={page} setPage={setPage}/></>}</State></section>
    <section className={styles.danger}><div><h2>Delete organization</h2><p>Permanently remove this workspace and its data. Billing cancellation, storage cleanup and account handling are tracked in a recoverable job.</p>{data.deletion&&<p>Cleanup: {data.deletion.status} · {data.deletion.stage}. Open Activity & cleanup to monitor or retry.</p>}</div><button disabled={!!data.deletion} onClick={()=>setConfirm(true)}><Trash2 size={16}/>Delete organization</button></section>
    {confirm&&<DeleteDialog organization={data.organization} close={()=>setConfirm(false)} done={()=>{setConfirm(false);onRefresh();}}/>}
  </>}</State></>;
}
function DeleteDialog({organization,close,done}) {
  const ref=useRef(null);const [name,setName]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  async function remove(e){e.preventDefault();setBusy(true);setError('');try{await request(`organizations/${organization.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmName:name,reason})});done();}catch(e){setError(e.message);setBusy(false);}}
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="delete-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}><form onSubmit={remove}><div className={styles.panelHeading}><h2 id="delete-title">Delete {organization.name}?</h2><button type="button" aria-label="Close deletion dialog" disabled={busy} onClick={close}><X size={20}/></button></div><p>This permanently deletes the organization, projects and related data. Its subscriptions will be cancelled; exclusively linked user accounts and files are cleaned up. Shared accounts and platform-owner logins are retained.</p><label>Type the exact organization name<input value={name} onChange={e=>setName(e.target.value)} autoFocus autoComplete="off" required maxLength={200}/></label><label>Reason for deletion<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500} required rows={3}/></label>{error&&<p role="alert" className={styles.error}>{error}</p>}<div className={styles.dialogActions}><button type="button" onClick={close} disabled={busy}>Cancel</button><button className={styles.destructiveButton} disabled={busy||name!==organization.name||reason.trim().length<8}>{busy?<><Loader2 size={16} className="animate-spin"/>Starting cleanup…</>:'Permanently delete organization'}</button></div></form></dialog>;
}
function ActivityPanel({refresh,onRefresh,open}) {
  const [page,setPage]=useState(1),[busy,setBusy]=useState(null),[error,setError]=useState('');
  const state=useData(`activity?page=${page}`,refresh);
  async function retry(id){setBusy(id);setError('');try{await request(`organizations/${id}`,{method:'PATCH'});onRefresh();}catch(e){setError(e.message);}finally{setBusy(null);}}
  return <State state={state}>{data=><><section className={styles.panel}><div className={styles.panelHeading}><div><h2>Cleanup queue</h2><p>{number(data.deletionsTotal)} pending jobs · newest 100 shown</p></div></div>{error&&<p role="alert" className={styles.error}>{error}</p>}{data.deletions.length?<Table headers={['Organization','Status','Stage','Attempts','']} >{data.deletions.map(j=><tr key={j.id}><td><button className={styles.textButton} onClick={()=>open(j.organization_id)}>{j.organization_name}</button>{j.last_error&&<small className={styles.jobError}>{j.last_error}</small>}</td><td><Badge>{j.status}</Badge></td><td>{j.stage}</td><td>{j.attempts}</td><td><button disabled={!!busy} className={styles.button} onClick={()=>retry(j.organization_id)}>{busy===j.organization_id?'Processing…':'Run cleanup step'}</button></td></tr>)}</Table>:<Empty>No pending cleanup jobs.</Empty>}</section><section className={styles.panel}><div className={styles.panelHeading}><div><h2>Owner activity</h2><p>Durable audit history of destructive actions</p></div></div>{data.items.length?<Table headers={['Action','Organization ID','Reason','When']}>{data.items.map(a=><tr key={a.id}><td>{a.action.replaceAll('.',' · ')}</td><td>{a.organization_id}</td><td>{a.reason}</td><td>{date(a.created_at)}</td></tr>)}</Table>:<Empty>No platform actions recorded.</Empty>}<Pagination data={data} page={page} setPage={setPage}/></section></>}</State>;
}
