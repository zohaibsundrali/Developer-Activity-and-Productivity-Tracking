'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/authFetch';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { supabase } from '@/utils/supabaseClient';
import { allowed } from '@/utils/permissions';
import { Button } from '@/components/ui';
export default function GithubIssueImport({projectId,link,number,token,onClose}) {
  const {authStatus}=useAuth(), identity=reportIdentity(getOrgContext()), org=getOrgContext()?.organizationId;
  const [preview,setPreview]=useState(null),[result,setResult]=useState(null),[start,setStart]=useState(''),[end,setEnd]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const permission=allowed('task.manage')&&(allowed('task.view_all')||allowed('task.review')),permissions=JSON.stringify(['task.manage','task.view_all','task.review','project.view_all','project.view_own'].map(k=>allowed(k))),binding=`${authStatus}:${identity}:${projectId}:${link.version}:${link.repository_id}:${number}:${permissions}:${revision}`,live=useRef(binding);live.current=binding;
  const generation=useRef(0),pending=useRef(false),controller=useRef(null);
  const current=(captured,ticket)=>live.current===captured&&generation.current===ticket&&reportIdentity(getOrgContext())===identity&&allowed('task.manage')&&(allowed('task.view_all')||allowed('task.review'));
  const visible=preview?.binding===binding?preview.data:null,receipt=result?.binding===binding?result.data:null;
  useEffect(()=>{const {data}=supabase.auth.onAuthStateChange(()=>{generation.current++;controller.current?.abort();setPreview(null);setResult(null);setRevision(n=>n+1);});return()=>data?.subscription?.unsubscribe();},[]);
  useEffect(()=>{const versions=generation,requests=controller;versions.current++;requests.current?.abort();pending.current=false;setPreview(null);setResult(null);setStart('');setEnd('');setBusy(false);setError('');return()=>{versions.current++;requests.current?.abort();};},[binding]);
  async function run(action){
    if(pending.current||!permission)return;pending.current=true;setBusy(true);setError('');const captured=binding,ticket=++generation.current,abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),35000);
    try{const response=await authFetch(`/api/projects/${projectId}/github/issues`,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({action,number,version:link.version,githubToken:token,...(action==='import'?{fingerprint:visible?.fingerprint,start,end}:{})})});const json=await response.json();if(!current(captured,ticket))return;
      if(!response.ok||!json.success)throw new Error(json.error||'The issue import could not be confirmed.');
      if(json.project_id!==projectId||json.organization_id!==org||json.version!==link.version)throw new Error('The import response did not match this project.');
      if(action==='preview'){if(json.issue?.number!==number||json.issue?.repository_id!==link.repository_id||typeof json.issue.title!=='string'||typeof json.issue.body!=='string'||!/^[a-f0-9]{64}$/.test(json.fingerprint))throw new Error('Invalid issue preview.');setPreview({binding:captured,data:json});setResult(null);}
      else {if(typeof json.unchanged!=='boolean'||typeof json.deleted!=='boolean'||(!json.deleted&&(!json.task||json.task.project_id!==projectId||json.task.organization_id!==org)))throw new Error('Invalid task receipt. Refresh and preview before retrying.');setResult({binding:captured,data:json});}
    }catch(e){if(current(captured,ticket))setError(e.name==='AbortError'?'The request timed out. Preview again to check whether the task was created before retrying.':e.message);}
    finally{clearTimeout(timeout);if(current(captured,ticket)){pending.current=false;setBusy(false);}}
  }
  if(authStatus!=='authenticated'||!permission)return null;
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="font-semibold">Import GitHub issue #{number}</h3><p className="text-sm">Import the issue title and body into this project’s task records. Authorized task viewers will be able to read that content. The task starts unassigned, internal and pending; GitHub status does not approve local work.</p>
    <Button disabled={busy} variant="outline" onClick={()=>run('preview')}>Preview issue import</Button><Button disabled={busy} variant="outline" onClick={onClose}>Close import</Button>
    {busy&&<p role="status">Checking issue import…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
    {visible&&<><h4 className="font-semibold">{visible.issue.title}</h4><p className="text-sm">GitHub: {visible.issue.state} · Updated {visible.issue.updated_at}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm">{visible.issue.body||'No issue description.'}</pre>
    {visible.existing?<p role="status">{visible.existing.task_id?'This issue was already imported. Its local task and edits are preserved.':'The imported task was deleted. Import will not recreate it automatically.'}</p>:!receipt&&<form onSubmit={e=>{e.preventDefault();run('import');}} className="space-y-3"><div className="flex flex-wrap gap-3"><label className="text-sm">Planned start<input required disabled={busy} type="date" value={start} onChange={e=>setStart(e.target.value)} className="block rounded border border-input bg-background p-2"/></label><label className="text-sm">Planned end<input required disabled={busy} type="date" min={start||undefined} value={end} onChange={e=>setEnd(e.target.value)} className="block rounded border border-input bg-background p-2"/></label></div><Button type="submit" disabled={busy}>Import as pending task</Button></form>}</>}
    {receipt&&<p role="status">{receipt.deleted?'The previously imported task was deleted; no replacement was created.':receipt.unchanged?'This issue was already imported. The existing task was kept.':`Task created: ${receipt.task.title}. Refresh the project task list to see it.`}</p>}
    <p className="text-xs text-muted-foreground">Imports are one-way snapshots. Re-importing never changes an existing task. Automatic synchronization and pull-request imports are not enabled.</p>
  </section>;
}
