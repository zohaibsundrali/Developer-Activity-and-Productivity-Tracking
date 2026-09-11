"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/utils/authFetch';
import { createDeletionRequestGuard, readDeletionStatus } from '@/utils/organizationDeletionRequests';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Field } from '@/components/ui';

const endpoint = '/api/organizations/delete';
export default function OrganizationDeletionPanel({ orgId }) {
  const [result,setResult]=useState(null),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState('');
  const scopeRef=useRef(orgId);scopeRef.current=orgId;
  const guard=useRef(null);if(!guard.current)guard.current=createDeletionRequestGuard(()=>scopeRef.current);
  const busyRef=useRef(false),receiptRef=useRef('');
  const [resultScope,setResultScope]=useState(null);
  const read=useCallback(async()=>{
    const request=guard.current.begin();
    try {
      const json=await readDeletionStatus({authenticatedFetch:authFetch,publicFetch:fetch,receipt:receiptRef.current});
      if(!guard.current.current(request))return;
      setResultScope(request.scope);
      setResult(json);setError('');
    }catch(e){if(guard.current.current(request)){setResultScope(request.scope);setError(e.message||'Could not load deletion status.');}}
  },[]);
  const invalidate=useCallback(()=>{guard.current.invalidate();},[]);
  useEffect(()=>{
    guard.current.invalidate();setResultScope(null);setResult(null);setError('');setName('');
    let token='';try{token=localStorage.getItem(`organization-deletion:${orgId}`)||'';}catch{}
    receiptRef.current=token;setReceipt(token);
    if(orgId)read();
    return invalidate;
  },[orgId,read,invalidate]);
  const mutate=async(method)=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');
    const request=guard.current.begin();
    try{
      const response=await authFetch(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(method==='POST'?{confirmName:name}:{})});
      const json=await response.json().catch(()=>({}));
      if(!guard.current.current(request))return;
      if(!response.ok)throw new Error(json.error||'Deletion could not progress. Refresh its status before retrying.');
      if(json.receiptToken){receiptRef.current=json.receiptToken;setReceipt(json.receiptToken);try{localStorage.setItem(`organization-deletion:${orgId}`,json.receiptToken);}catch{}}
      setResultScope(request.scope);setResult(json);
    }catch(e){if(guard.current.current(request))setError(e.message||'Deletion could not progress.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  if(!orgId||resultScope!==orgId||(!result&&!error))return null;
  const job=result?.job;
  return <Card><CardHeader><CardTitle>Delete organization permanently</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Starting deletion freezes organization access. Queued cleanup then cancels the Stripe subscription without proration or refund and permanently deletes organization data, files, and eligible accounts. A partial deletion cannot be restored. Failed steps must be retried.</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {job?<div className="space-y-2" aria-live="polite"><p>Status: {job.status}. Step: {job.stage}.</p>
      {job.lastError&&<p role="alert">{job.lastError}</p>}
      {job.counts&&<p className="text-sm">Files remaining: {job.counts.storagePending ?? 0}. Accounts remaining: {job.counts.authPending ?? 0}. Shared accounts retained: {job.counts.authRetained ?? 0}.</p>}
      <Button type="button" variant="outline" disabled={busy} onClick={read}>Refresh status</Button>
      {['pending','retry'].includes(job.status)&&result?.canDelete&&<Button type="button" disabled={busy} onClick={()=>mutate('PATCH')}>{busy?'Continuing…':job.status==='pending'?'Continue cleanup':'Retry cleanup'}</Button>}
    </div>:result?.canDelete?<div className="space-y-3"><Field label={`Type ${result.organizationName} to confirm`}><Input value={name} onChange={e=>setName(e.target.value)} disabled={busy} autoComplete="off" /></Field>
      <Button type="button" variant="destructive" disabled={busy||name!==result.organizationName} onClick={()=>mutate('POST')}>{busy?'Starting deletion…':'Permanently delete organization'}</Button></div>:<Button type="button" variant="outline" onClick={read}>Retry loading status</Button>}
    {receipt&&<div className="space-y-1 text-sm"><p>Save this private receipt link before leaving. It remains read-only after account removal.</p><a className="underline break-all" href={`${endpoint}?receipt=${encodeURIComponent(receipt)}`} target="_blank" rel="noreferrer">Open deletion receipt</a></div>}
  </CardContent></Card>;
}
