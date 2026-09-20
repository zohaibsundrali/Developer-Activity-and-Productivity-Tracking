'use client';
import { useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { authFetch } from '@/utils/authFetch';
import styles from './PlatformConsole.module.css';
export const number = value => new Intl.NumberFormat('en').format(value ?? 0);
export const date = value => value ? new Date(value).toLocaleDateString('en', {day:'numeric',month:'short',year:'numeric'}) : '—';
export const money = (cents, currency='USD') => { try { return new Intl.NumberFormat('en',{style:'currency',currency}).format((cents || 0)/100); } catch { return `${number((cents || 0)/100)} ${currency}`; } };
export async function request(path, options) {
  const res = await authFetch(`/api/platform/${path}`, { cache:'no-store', ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed. Please retry.'),{...data,status:res.status});
  return data;
}
export function useData(path, refresh=0) {
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
export function Badge({children}) { return <span className={styles.badge} data-tone={['active','paid','completed'].includes(children)?'good':['past_due','unpaid','retry','suspended'].includes(children)?'warning':'neutral'}>{String(children || 'Not recorded').replaceAll('_',' ')}</span>; }
export function Empty({children='No records to show yet.'}) { return <div className={styles.empty}>{children}</div>; }
export function State({state,children}) {
  if(state.loading)return <div role="status" className={styles.empty}><Loader2 className="animate-spin motion-reduce:animate-none" size={22}/>Loading records…</div>;
  if(state.error)return <div role="alert" className={styles.error}>{state.error.message}</div>;
  return children(state.data);
}
export function Pagination({data,page,setPage}) { const pages=Math.max(1,Math.ceil(data.total/data.pageSize));return <div className={styles.pagination}><span>{number(data.total)} records · Page {page} of {pages}</span><div><button aria-label="Previous page" disabled={page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><button aria-label="Next page" disabled={page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button></div></div>; }
export function Metric({label,value,note,icon:Icon}) {return <article className={styles.metric}><div><span>{label}</span>{Icon&&<Icon size={18}/>}</div><strong>{number(value)}</strong><small>{note}</small></article>;}
export function Table({headers,children}) {return <div className={styles.tableWrap}><table><thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
