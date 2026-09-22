'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import { ROLES } from '@/utils/roles';
import { authFetch } from '@/utils/authFetch';
import { supabase } from '@/utils/supabaseClient';
import { Badge, Empty, State, Table, Pagination, date, money, number, request, useData } from './PlatformUI';
import styles from './PlatformConsole.module.css';

export const can = (access, permission) => access?.role === 'owner' || access?.permissions?.includes('*') || access?.permissions?.includes(permission);
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)).toString();
const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function ActionDialog({ title, description, fields = [], confirmName, submit, close, done, destructive = false }) {
  const ref = useRef(null);
  const [values, setValues] = useState(Object.fromEntries(fields.map(f => [f.name, f.value ?? ''])));
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await submit({ ...values, reason, ...(confirmName ? { confirmName: confirmation } : {}) }); done?.(result); close(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="action-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={save}>
      <div className={styles.panelHeading}><h2 id="action-title">{title}</h2><button type="button" aria-label="Close action" onClick={close} disabled={busy}><X size={20}/></button></div>
      <p>{description}</p>
      {fields.map(field => <label key={field.name}>{field.label}
        {field.options ? <select value={values[field.name]} required={field.required !== false} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}>
          <option value="">Choose…</option>{field.options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
        </select> : <input type={field.type || 'text'} value={values[field.name]} required={field.required !== false} min={field.min} max={field.max} step={field.step} maxLength={field.maxLength || 250} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}/>}
        {field.note && <small>{field.note}</small>}
      </label>)}
      {confirmName && <label>Type “{confirmName}” to confirm<input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} required/></label>}
      <label>Reason for this action<textarea required minLength={8} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)}/></label>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      <div className={styles.dialogActions}><button type="button" disabled={busy} onClick={close}>Cancel</button><button className={destructive ? styles.destructiveButton : styles.primaryButton} disabled={busy || reason.trim().length < 8 || (!!confirmName && confirmation !== confirmName)}>{busy ? <><Loader2 size={16} className="animate-spin"/>Saving…</> : 'Confirm action'}</button></div>
    </form>
  </dialog>;
}

export function Filters({ value, onChange, statuses = [], organization = true, search = true }) {
  const [draft, setDraft] = useState(value);
  return <form className={styles.filters} onSubmit={e => { e.preventDefault(); onChange(draft); }}>
    {search && <label>Search<input placeholder="Name or email" value={draft.search || ''} maxLength={100} onChange={e => setDraft({ ...draft, search: e.target.value })}/></label>}
    {organization && <label>Organization ID<input placeholder="All organizations" value={draft.organizationId || ''} onChange={e => setDraft({ ...draft, organizationId: e.target.value })}/></label>}
    {!!statuses.length && <label>Status<select value={draft.status || ''} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">All statuses</option>{statuses.map(status => <option key={status.value || status} value={status.value || status}>{status.label || status.replaceAll('_', ' ')}</option>)}</select></label>}
    <label>From<input type="date" value={draft.from || ''} onChange={e => setDraft({ ...draft, from: e.target.value })}/></label>
    <label>To<input type="date" value={draft.to || ''} min={draft.from} onChange={e => setDraft({ ...draft, to: e.target.value })}/></label>
    <button className={styles.button}>Apply filters</button>
    <button className={styles.textButton} type="button" onClick={() => { setDraft({}); onChange({}); }}>Clear</button>
  </form>;
}

export function ExportButtons({ dataset, filters = {} }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  async function download(format) {
    setBusy(format); setError('');
    try {
      const response = await authFetch(`/api/platform/export?${query({ ...filters, dataset, format })}`, { cache: 'no-store' });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Export failed.'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `verisade-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  return <div><div className={styles.actions}>{['csv', 'pdf'].map(format => <button className={styles.button} key={format} disabled={!!busy} onClick={() => download(format)}><Download size={14}/>{busy === format ? 'Exporting…' : format.toUpperCase()}</button>)}</div>{error && <p role="alert" className={styles.error}>{error}</p>}</div>;
}

export function ProjectsPanel({ refresh, onRefresh, access }) {
  const [filters, setFilters] = useState({}), [page, setPage] = useState(1), [action, setAction] = useState(null), [selected, setSelected] = useState(null);
  const state = useData(`projects?${query({ ...filters, page })}`, refresh);
  const detail = useData(selected ? `projects/${selected.id}` : null, refresh);
  return <>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Projects across your platform</h2><p>Inspect work, archive inactive projects and manage their lifecycle.</p></div><ExportButtons dataset="projects" filters={filters}/></div>
      <Filters value={filters} onChange={v => { setFilters(v); setPage(1); }} statuses={[{value:'active',label:'Not archived'},{value:'archived',label:'Archived'}]}/>
      <State state={state}>{data => <>{data.items.length ? <Table headers={['Project', 'Organization', 'Status', 'Created', 'Actions']}>{data.items.map(row => <tr key={row.id}>
        <td><button className={styles.textButton} onClick={() => setSelected(row)}>{row.name}</button></td><td>{row.organizations?.name || row.organization_name || row.organization_id}</td><td><Badge>{row.archived ? 'archived' : row.status}</Badge></td><td>{date(row.created_at)}</td>
        <td><div className={styles.actions}><button className={styles.button} onClick={() => setSelected(row)}>Inspect</button>{can(access, 'projects.manage') && <><button className={styles.button} onClick={() => setAction({ row, type: row.archived ? 'restore' : 'archive' })}>{row.archived ? 'Restore' : 'Archive'}</button><button className={styles.dangerText} onClick={() => setAction({ row, type: 'delete' })}>Delete</button></>}</div></td>
      </tr>)}</Table> : <Empty>No matching projects.</Empty>}<Pagination data={data} page={page} setPage={setPage}/></>}</State>
    </section>
    {selected && <section className={styles.panel}><div className={styles.panelHeading}><h2>{selected.name}</h2><button aria-label="Close project details" onClick={() => setSelected(null)}><X size={18}/></button></div><State state={detail}>{data => <div className={styles.detailBody}><p>{data.project.description || 'No description recorded.'}</p><div className={styles.organizationMeta}><div><span>Tasks</span><strong>{number(data.tasks)}</strong></div><div><span>Members</span><strong>{number(data.members)}</strong></div><div><span>Status</span><Badge>{data.project.archived ? 'archived' : data.project.status}</Badge></div></div></div>}</State></section>}
    {action && <ActionDialog title={`${action.type[0].toUpperCase() + action.type.slice(1)} ${action.row.name}`} description={action.type === 'delete' ? 'Permanently delete this project and its related database records. Stored attachments remain under the organization storage lifecycle. This cannot be undone.' : action.type === 'archive' ? 'Remove this project from active work. You can restore it later.' : 'Return this project to active work.'} destructive={action.type === 'delete'} confirmName={action.type === 'delete' ? action.row.name : undefined} close={() => setAction(null)} done={onRefresh} submit={values => post(`projects/${action.row.id}`, { ...values, action: action.type })}/>}
  </>;
}

export function SecurityPanel({ onVerified, access }) {
  const [policyAction,setPolicyAction]=useState(false);
  const [factors, setFactors] = useState([]), [enrollment, setEnrollment] = useState(null), [factorId, setFactorId] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [verified, setVerified] = useState(false);
  useEffect(() => { let active = true; supabase.auth.mfa.listFactors().then(({ data, error }) => { if (!active) return; if (error) setError(error.message); else { setFactors(data.totp); setFactorId(data.totp.find(f => f.status === 'verified')?.id || ''); } }); return () => { active = false; }; }, []);
  async function enroll() {
    setBusy(true); setError('');
    try { const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Verisade platform ${new Date().toISOString()}` }); if (error) throw error; setEnrollment(data); setFactorId(data.id); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function verify(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code }); if (error) throw error; setVerified(true); setEnrollment(null); setCode(''); onVerified?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Account security</h2><p>Use an authenticator app to protect privileged platform access.</p></div><ShieldCheck size={22}/></div><div className={styles.securityBody}>
    {verified ? <p role="status" className={styles.success}>Authenticator verified. Your session now has multi-factor assurance.</p> : <>
      {!factorId && <><p>Set up an authenticator, then enter its six-digit code. Keep your authenticator available for future platform sign-ins.</p><button className={styles.primaryButton} disabled={busy} onClick={enroll}>{busy ? 'Preparing…' : 'Set up authenticator'}</button></>}
      {enrollment && <div className={styles.enrollment}><img src={enrollment.totp.qr_code.startsWith('data:') ? enrollment.totp.qr_code : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.totp.qr_code)}`} width="200" height="200" alt="Scan this QR code with your authenticator app"/><details><summary>Enter setup key manually</summary><code>{enrollment.totp.secret}</code></details></div>}
      {factorId && <form onSubmit={verify} className={styles.mfaForm}>{factors.filter(f => f.status === 'verified').length > 1 && <label>Authenticator<select value={factorId} onChange={e => setFactorId(e.target.value)}>{factors.filter(f => f.status === 'verified').map(f => <option key={f.id} value={f.id}>{f.friendly_name || f.id}</option>)}</select></label>}<label>Authenticator code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/></label><button className={styles.primaryButton} disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify authenticator'}</button></form>}
    </>}{error && <p role="alert" className={styles.error}>{error}</p>}
    {access?.role==='owner'&&<div className={styles.notice}><p>Platform MFA policy: {access.mfaRequired?'Required':'Optional'}</p><button className={styles.button} disabled={!access.mfaSatisfied} onClick={()=>setPolicyAction(true)}>{access.mfaRequired?'Make MFA optional for my platform access':'Require MFA for my platform access'}</button>{!access.mfaSatisfied&&<p>Verify your authenticator before changing this policy.</p>}</div>}
    {policyAction&&<ActionDialog title="Update your MFA policy" description={access.mfaRequired?'Allow platform access after primary sign-in. Your authenticator remains enrolled.':'Require an authenticator verification for future platform sessions.'} close={()=>setPolicyAction(false)} done={onVerified} submit={values=>post('management',{...values,action:'team.mfa',mfaRequired:!access.mfaRequired})}/>}
  </div></section>;
}

export function MembersPanel({ refresh, onRefresh, access }) {
  const [filters, setFilters] = useState({}), [page, setPage] = useState(1), [action, setAction] = useState(null), [invite, setInvite] = useState(null);
  const state = useData(`management?${query({ ...filters, kind: 'members', page })}`, refresh);
  const roles = ROLES;
  function dialog(row, type) {
    const config = {
      role: { title: 'Change member role', description: 'Update access within this organization.', fields: [{ name: 'role', label: 'Workspace role', value: row.role, options: roles }], action: 'member.role' },
      status: { title: row.status === 'active' ? 'Revoke workspace access' : 'Restore workspace access', description: 'This changes access to this workspace. Other workspace memberships remain available.', action: 'member.status', status: row.status === 'active' ? 'suspended' : 'active' },
      sessions: { title: 'Revoke user sessions', description: 'Revoke existing application sessions for this identity across workspaces. They can sign in again if their access is still active.', action: 'member.sessions' },
    }[type];
    setAction({ ...config, row });
  }
  return <>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Workspace members</h2><p>Manage membership permissions and account sessions.</p></div><div className={styles.actions}><ExportButtons dataset="members" filters={filters}/>{can(access, 'members.manage') && <button className={styles.primaryButton} onClick={() => setAction({ title: 'Invite workspace member', description: 'Create an invitation for the selected organization.', action: 'member.invite', fields: [{ name: 'organizationId', label: 'Organization ID', value: filters.organizationId }, { name: 'email', label: 'Email', type: 'email' }, { name: 'role', label: 'Workspace role', options: roles.filter(role => role !== 'owner'), value: 'developer' }] })}><Plus size={15}/>Invite member</button>}</div></div>
      <Filters value={filters} onChange={v => { setFilters(v); setPage(1); }} statuses={['active', 'invited', 'suspended']}/>
      {invite && <div className={styles.notice}><strong>{invite.emailed ? 'Invitation sent.' : 'Invitation created.'}</strong>{invite.inviteLink && <label>Invitation link<input readOnly value={invite.inviteLink} onFocus={e => e.target.select()}/></label>}<button className={styles.textButton} onClick={() => setInvite(null)}>Dismiss</button></div>}
      <State state={state}>{data => <>{data.items.length ? <Table headers={['Email', 'Organization', 'Role', 'Status', 'Actions']}>{data.items.map(row => <tr key={row.id}><td>{row.email || 'No email recorded'}</td><td>{row.organization_name || row.organizations?.name || row.organization_id}</td><td>{row.role}</td><td><Badge>{row.status}</Badge></td><td>{can(access, 'members.manage') && <div className={styles.actions}><button className={styles.button} onClick={() => dialog(row, 'role')}>Change role</button><button className={styles.button} onClick={() => dialog(row, 'status')}>{row.status === 'active' ? 'Revoke access' : 'Restore access'}</button><button className={styles.textButton} onClick={() => dialog(row, 'sessions')}>Revoke sessions</button></div>}</td></tr>)}</Table> : <Empty>No matching members.</Empty>}<Pagination data={data} page={page} setPage={setPage}/></>}</State>
    </section>
    {action && <ActionDialog {...action} close={() => setAction(null)} done={result => { if (action.action === 'member.invite') setInvite(result); onRefresh(); }} submit={values => post('management', { ...values, action: action.action, ...(action.row ? { membershipId: action.row.id } : {}), ...(action.status ? { status: action.status } : {}) })}/>}
  </>;
}

export function OrganizationControls({ organizationId, access, refresh, onRefresh }) {
  const state = useData(can(access, 'organizations.manage') ? `management?kind=organization&organizationId=${organizationId}` : null, refresh);
  const [action, setAction] = useState(false);
  if (!can(access, 'organizations.manage')) return null;
  return <section className={styles.panel}><State state={state}>{data => { const organization = data.organization || data; const suspended = organization.status === 'suspended'; return <>
    <div className={styles.panelHeading}><div><h2>Workspace access</h2><p>{suspended ? 'This organization is suspended.' : 'Members can access this organization.'}</p></div><div className={styles.actions}><Badge>{organization.status || 'active'}</Badge><button className={styles.button} onClick={() => setAction(true)}>{suspended ? 'Reactivate organization' : 'Suspend organization'}</button></div></div>
    {action && <ActionDialog title={suspended ? 'Reactivate organization' : 'Suspend organization'} description={suspended ? 'Restore access for active workspace members.' : 'Temporarily block workspace access. Stored data is retained and billing remains unchanged.'} close={() => setAction(false)} done={onRefresh} submit={values => post('management', { ...values, action: 'organization.status', organizationId, status: suspended ? 'active' : 'suspended' })}/>}
  </>; }}</State></section>;
}

export function TeamPanel({ refresh, onRefresh, access }) {
  const [page, setPage] = useState(1), [action, setAction] = useState(null);
  const state = useData('management?kind=team&page=' + page, refresh);
  const fields = (row = {}) => [{ name: 'email', label: 'Verified account email', type: 'email', value: row.email }, { name: 'role', label: 'Platform role', options: ['owner', 'support', 'billing'], value: row.role || 'support' }, { name: 'mfaRequired', label: 'Require authenticator for platform access', options: [{ value: 'true', label: 'Required' }, { value: 'false', label: 'Optional' }], value: String(row.mfa_required ?? true) }];
  return <>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Platform team</h2><p>Owner: full administration. Support: workspace operations. Billing: payments and reports.</p></div>{can(access, 'team.manage') && <button className={styles.primaryButton} onClick={() => setAction({ type: 'upsert', fields: fields() })}><Plus size={15}/>Add team member</button>}</div>
      <State state={state}>{data => <>{data.items.length ? <Table headers={['Account', 'Role', 'MFA policy', 'Actions']}>{data.items.map(row => <tr key={row.auth_user_id}><td>{row.email || row.auth_user_id}</td><td><Badge>{row.role}</Badge></td><td>{row.mfa_required ? 'Required' : 'Optional'}</td><td>{can(access, 'team.manage') && <div className={styles.actions}><button className={styles.button} onClick={() => setAction({ type: 'upsert', fields: fields(row) })}>Edit access</button><button className={styles.dangerText} onClick={() => setAction({ type: 'remove', row })}>Remove access</button></div>}</td></tr>)}</Table> : <Empty>No team records.</Empty>}<Pagination data={data} page={page} setPage={setPage}/></>}</State>
    </section>
    {action && <ActionDialog title={action.type === 'remove' ? 'Remove platform access' : 'Set platform access'} description={action.type === 'remove' ? 'Remove this account from the platform team. Workspace memberships are retained.' : 'Use an existing verified account. Platform access is separate from organization roles.'} fields={action.fields} destructive={action.type === 'remove'} close={() => setAction(null)} done={onRefresh} submit={values => post('management', { ...values, action: `team.${action.type}`, ...(action.row ? { authUserId: action.row.auth_user_id } : { mfaRequired: values.mfaRequired === 'true' }) })}/>}
  </>;
}

export function BillingActions({ organizationId, invoiceId, access, onRefresh }) {
  const [action, setAction] = useState(null), [receipt, setReceipt] = useState(null);
  const state = useData(action ? `billing/actions?organizationId=${organizationId}` : null);
  const requestId = useRef(null);
  if (!can(access, 'billing.manage')) return null;
  const choose = type => { requestId.current = crypto.randomUUID(); setAction(type); };
  return <><div className={styles.actions}>
    {invoiceId ? <button className={styles.textButton} onClick={() => choose('refund')}>Refund</button> : <><button className={styles.button} onClick={() => choose('change_plan')}>Change plan</button><button className={styles.button} onClick={() => choose('extend_trial')}>Extend trial</button><button className={styles.textButton} onClick={() => choose('cancel_subscription')}>Cancel subscription</button><button className={styles.textButton} onClick={() => choose('requests')}>Recent requests</button></>}
  </div>{receipt&&<p role="status" className={styles.caption}>Action accepted. {receipt.sync === 'webhook_pending' ? 'Waiting for billing provider sync; refresh to see updated records.' : 'Refresh to view the latest billing records.'}</p>}{action&&state.error&&<div className={styles.notice}><p role="alert">{state.error.message}</p><button className={styles.button} onClick={()=>setAction(null)}>Close</button></div>}{action && !state.error && <State state={state}>{data => action==='requests'?<BillingRequestDialog requests={data.requests || []} close={()=>setAction(null)} done={onRefresh}/>:<ActionDialog title={{ change_plan: 'Change subscription plan', extend_trial: 'Extend trial', cancel_subscription: 'Cancel at period end', refund: 'Refund invoice payment' }[action]} description={action === 'change_plan' ? 'The billing provider will update this subscription without prorations. Changing the billing interval may trigger an immediate charge. Shared workspaces use this same billing account.' : action === 'cancel_subscription' ? 'Cancel renewal at the end of the current billing period. Every workspace sharing this subscription is affected.' : action === 'extend_trial' ? 'Set a future trial end date for this subscription.' : 'Refund a paid amount through the payment provider. Enter the amount in the smallest currency unit (for example, 1000 cents = 10.00).'} fields={action === 'change_plan' ? [{ name: 'planCode', label: 'New plan', options: (data.plans || []).map(p => ({ value: p.code, label: `${p.name || p.code} · ${money(p.amount_cents, p.currency)} / ${p.billing_interval}` })) }] : action === 'extend_trial' ? [{ name: 'trialEnd', label: 'Trial ends', type: 'datetime-local' }] : action === 'refund' ? [{ name: 'amountCents', label: 'Refund amount in smallest currency unit', type: 'number', min: 1, step: 1 }] : []} destructive={action === 'refund' || action === 'cancel_subscription'} close={() => setAction(null)} done={result=>{setReceipt(result);onRefresh();}} submit={values => post('billing/actions', { ...values, action, organizationId, invoiceId, requestId: requestId.current, ...(values.amountCents ? { amountCents: Number(values.amountCents) } : {}), ...(values.trialEnd ? { trialEnd: new Date(values.trialEnd).toISOString() } : {}) })}/>}</State>}</>;
}

function BillingRequestDialog({requests,close,done}) {
  const ref=useRef(null),[busy,setBusy]=useState(null),[error,setError]=useState(''),[providerIds,setProviderIds]=useState({});
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  async function resume(row){setBusy(row.id);setError('');try{await post('billing/actions',row.payload);done();close();}catch(e){setError(e.message);}finally{setBusy(null);}}
  async function reconcile(row){setBusy(row.id);setError('');try{await post('billing/reconcile',{organizationId:row.payload.organizationId,requestId:row.id,providerId:providerIds[row.id]||undefined});done();close();}catch(e){setError(e.message);}finally{setBusy(null);}}
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="requests-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}><div className={styles.panelHeading}><h2 id="requests-title">Recent billing requests</h2><button aria-label="Close requests" disabled={!!busy} onClick={close}><X size={20}/></button></div><p>Resume an unfinished request using its original details and request ID. A pending request is available after two minutes.</p>{error&&<p role="alert" className={styles.error}>{error}</p>}{requests.length?<div className={styles.requestList}>{requests.map(row=><article key={row.id}><strong>{row.payload?.action?.replaceAll('_',' ') || 'Billing action'}</strong><Badge>{row.status}</Badge><small>{date(row.created_at)} · {row.id}</small>{row.status!=='completed'&&<><button className={styles.button} disabled={!!busy || row.can_retry===false || Date.now()-Date.parse(row.created_at)>23*60*60*1000 || (row.status==='pending'&&Date.now()-Date.parse(row.updated_at || row.created_at)<120000)} onClick={()=>resume(row)}>{busy===row.id?'Resuming…':'Resume original request'}</button>{row.payload?.action==='refund'&&<label>Provider refund ID<input placeholder="re_…" value={providerIds[row.id]||''} onChange={e=>setProviderIds({...providerIds,[row.id]:e.target.value})}/></label>}<button className={styles.button} disabled={!!busy || row.can_reconcile===false || (row.payload?.action==='refund'&&!providerIds[row.id]?.startsWith('re_'))} onClick={()=>reconcile(row)}>Verify provider result</button></>}</article>)}</div>:<Empty>No requests recorded for this account.</Empty>}</dialog>;
}

export function AnalyticsPanel({ refresh }) {
  const [filters, setFilters] = useState({});
  const state = useData(`analytics?${query(filters)}`, refresh);
  return <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Revenue analytics</h2><p>Currency-separated estimates and recorded payment performance.</p></div></div><Filters value={filters} onChange={setFilters} organization={false} search={false}/>
    <State state={state}>{data => <><Table headers={['Currency', 'Est. MRR', 'Est. ARR', 'Collected', 'Refunded', 'Net collected', 'Outstanding']}>{data.currencies.map(row => <tr key={row.currency}><td>{row.currency.toUpperCase()}</td>{['mrr_cents', 'arr_cents', 'paid_cents', 'refunded_cents', 'net_collected_cents', 'outstanding_cents'].map(key => <td key={key}>{money(row[key], row.currency)}</td>)}</tr>)}</Table>{!data.currencies.length && <Empty>No revenue records in this period.</Empty>}<div className={styles.notice}><strong>Subscription churn: {data.churn?.rate == null ? 'Not enough history' : `${Number(data.churn.rate).toFixed(1)}%`}</strong><p>{number(data.churn?.canceled)} canceled · {number(data.churn?.starting_subscriptions)} subscriptions at period start</p>{data.notes?.map(note => <p key={note}>{note}</p>)}</div></>}</State>
  </section>;
}

export function HealthPanel({ refresh, onRefresh, access }) {
  const state = useData('health', refresh);
  const [error, setError] = useState(''), [busy, setBusy] = useState(null);
  async function acknowledge(alert) { setBusy(alert.id); setError(''); try { await post('alerts', { id: alert.id, acknowledged: !alert.acknowledged_at }); onRefresh(); } catch (e) { setError(e.message); } finally { setBusy(null); } }
  return <State state={state}>{data => <>
    <div className={styles.metrics}>{[['Failed webhooks', data.summary.failed_webhooks], ['Pending cleanups', data.summary.pending_cleanup], ['Stale tracker devices', data.summary.stale_devices], ['Storage objects', data.summary.storage_objects]].map(([label, value]) => <article className={styles.metric} key={label}><div>{label}</div><strong>{number(value)}</strong></article>)}</div>
    <p className={styles.caption}>Storage used: {(Number(data.summary.storage_bytes || 0) / 1024 / 1024).toFixed(1)} MB. {data.notes?.join(' ')}</p>
    <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Operational alerts</h2><p>Payment failures, expiring trials and cleanup issues.</p></div></div>{error && <p role="alert" className={styles.error}>{error}</p>}{data.alerts.length ? <Table headers={['Alert', 'Organization', 'Created', 'Status', 'Action']}>{data.alerts.map(alert => <tr key={alert.id}><td><strong>{alert.kind.replaceAll('_', ' ')}</strong><p>{alert.message}</p></td><td>{alert.organization_id || 'Platform'}</td><td>{date(alert.created_at)}</td><td><Badge>{alert.acknowledged_at ? 'acknowledged' : 'open'}</Badge></td><td>{can(access, 'alerts.manage') && <button className={styles.button} disabled={busy === alert.id} onClick={() => acknowledge(alert)}>{alert.acknowledged_at ? 'Reopen' : 'Acknowledge'}</button>}</td></tr>)}</Table> : <Empty>No current alerts.</Empty>}</section>
    <RecordsPanel title="Failed webhook deliveries" rows={data.webhooks} columns={['stripe_event_id', 'event_type', 'organization_id', 'processing_error', 'created_at']}/>
    <RecordsPanel title="Tracker heartbeat gaps" rows={data.devices} columns={['id', 'organization_id', 'name', 'platform', 'last_seen_at']}/>
    <RecordsPanel title="Cleanup jobs" rows={data.jobs} columns={['organization_name', 'status', 'stage', 'attempts', 'last_error']}/>
  </>}</State>;
}
function RecordsPanel({ title, rows = [], columns }) {
  return <section className={styles.panel}><div className={styles.panelHeading}><h2>{title}</h2></div>{rows.length ? <Table headers={columns.map(c => c.replaceAll('_', ' '))}>{rows.map((row, i) => <tr key={row.id || i}>{columns.map(key => <td key={key}>{key.endsWith('_at') ? date(row[key]) : String(row[key] ?? '—')}</td>)}</tr>)}</Table> : <Empty>No records requiring attention.</Empty>}</section>;
}
