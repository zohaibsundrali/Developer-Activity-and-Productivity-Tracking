'use client';
import { useEffect,useRef,useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/authFetch';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { allowed } from '@/utils/permissions';
import { supabase } from '@/utils/supabaseClient';
import { Button } from '@/components/ui';
export default function GithubIssueSync({projectId,link,number,token}) {
 const {authStatus}=useAuth(),identity=reportIdentity(getOrgContext()),org=getOrgContext()?.organizationId;
 const [preview,setPreview]=useState(null),[selected,setSelected]=useState({title:'',description:''}),[receipt,setReceipt]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const permission=allowed('task.manage')&&(allowed('task.view_all')||allowed('task.review'));
 const permissions=JSON.stringify(['task.manage','task.view_all','task.review','project.view_all','project.view_own'].map(k=>allowed(k)));
 const binding=`${authStatus}:${identity}:${projectId}:${link.version}:${link.repository_id}:${number}:${permissions}:${revision}`,live=useRef(binding);live.current=binding;
 const generation=useRef(0),pending=useRef(false),controller=useRef(null),requestId=useRef(null);
 const state=preview?.binding===binding?preview.data:null;
 const current=(captured,ticket)=>live.current===captured&&generation.current===ticket&&reportIdentity(getOrgContext())===identity&&allowed('task.manage')&&(allowed('task.view_all')||allowed('task.review'));
 useEffect(()=>{const {data}=supabase.auth.onAuthStateChange(()=>{generation.current++;controller.current?.abort();setPreview(null);setReceipt(null);setRevision(n=>n+1);});return()=>data?.subscription?.unsubscribe();},[]);
 useEffect(()=>{const versions=generation,requests=controller;versions.current++;requests.current?.abort();pending.current=false;requestId.current=null;setPreview(null);setReceipt(null);setBusy(false);setError('');return()=>{versions.current++;requests.current?.abort();};},[binding]);
 async function run(action){
  if(pending.current||!permission)return;pending.current=true;setBusy(true);setError('');const captured=binding,ticket=++generation.current,abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),35000);
  try{const response=await authFetch(`/api/projects/${projectId}/github/sync`,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({action,number,version:link.version,githubToken:token,...(action==='sync'?{id:requestId.current,importId:state.snapshot.import_id,expected:state.expected,fingerprint:state.fingerprint,...selected}:{})})});const json=await response.json();if(!current(captured,ticket))return;
   if(!response.ok||!json.success)throw new Error(json.error||'Synchronization could not be confirmed.');
   if(json.project_id!==projectId||json.organization_id!==org||json.version!==link.version)throw new Error('The response does not match this project.');
   if(action==='preview'){if(!Array.isArray(json.fields)||json.fields.length!==2||json.fields[0].field!=='title'||json.fields[1].field!=='description'||!/^[a-f0-9]{32}$/.test(json.expected||'')||!/^[a-f0-9]{64}$/.test(json.fingerprint||''))throw new Error('Invalid synchronization preview.');setPreview({binding:captured,data:json});setSelected(Object.fromEntries(json.fields.map(f=>[f.field,f.suggested])));setReceipt(null);requestId.current=crypto.randomUUID();}
   else{if(json.id!==requestId.current||typeof json.unchanged!=='boolean'||!Number.isSafeInteger(json.revision))throw new Error('Invalid synchronization receipt. Preview again before retrying.');setReceipt({binding:captured,data:json});}
  }catch(e){if(current(captured,ticket))setError(e.name==='AbortError'?'Request timed out. Retry with the same choices, or preview again to check the saved result.':e.message);}
  finally{clearTimeout(timeout);if(current(captured,ticket)){pending.current=false;setBusy(false);}}
 }
 if(authStatus!=='authenticated'||!permission)return null;
 return <section className="space-y-3 rounded-lg border border-border p-4"><h4 className="font-semibold">Refresh imported task from GitHub</h4><p className="text-sm">Compare the last GitHub snapshot, current local task and latest issue. Only title and description can change here. Task status, assignments, dates and approvals keep their local workflow.</p><Button disabled={busy} variant="outline" onClick={()=>run('preview')}>Preview task refresh</Button>
 {busy&&<p role="status">Checking task changes…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
 {state&&<form onSubmit={e=>{e.preventDefault();run('sync');}} className="space-y-4">{state.fields.map(field=><div key={field.field} className="space-y-2"><h5 className="font-semibold capitalize">{field.field}{field.conflict?' — conflict: choose a version':''}</h5><div className="grid gap-2 md:grid-cols-3">{[['Last GitHub snapshot',field.baseline],['Current local task',field.local],['Latest GitHub issue',field.incoming]].map(([label,value])=><div key={label}><p className="text-sm font-medium">{label}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-sm">{value??'(empty)'}</pre></div>)}</div><label className="block text-sm">Use for {field.field}<select required aria-label={`${field.field} resolution`} disabled={busy||receipt?.binding===binding} value={selected[field.field]} onChange={e=>{setSelected({...selected,[field.field]:e.target.value});requestId.current=crypto.randomUUID();}} className="ml-2 rounded border border-input bg-background p-2"><option value="">Choose a version</option>{!field.conflict&&<option value="auto">{field.action==='update'?'Apply GitHub change':'Keep current value'}</option>}<option value="local">Keep local version</option><option value="github">Use GitHub version</option></select></label></div>)}<p className="text-sm">Keeping local content also records the latest GitHub snapshot, so the same remote change will not repeatedly prompt for a decision. A later remote edit may require another review.</p><Button type="submit" disabled={busy||!selected.title||!selected.description||receipt?.binding===binding}>Apply chosen changes</Button></form>}
 {receipt?.binding===binding&&<p role="status">{receipt.data.unchanged?'This sync request was already recorded.':'Chosen changes were saved.'} Refresh the task list to see current content.</p>}
 </section>;
}
