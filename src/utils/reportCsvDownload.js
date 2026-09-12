import { authFetch } from '@/utils/authFetch';
import { downloadReportBlob } from '@/utils/reportExport';

/** Fetch streamed CSV without retaining the report's source row objects. */
export async function exportReportCsv(range,view,{shouldContinue=()=>true,filename=view}={}){
  if(!shouldContinue())return;
  const q=new URLSearchParams({...range,view});
  const response=await authFetch(`/api/reports/export?${q}`);
  if(!shouldContinue()){await response.body?.cancel();return;}
  if(!response.ok){const json=await response.json().catch(()=>({}));throw new Error(json.error||'Report export failed. Please retry.');}
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='text/csv'){
    await response.body?.cancel();
    throw new Error('Could not confirm the report export.');
  }
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Report export could not start.');
  const chunks=[];
  try{
    while(true){
      if(!shouldContinue()){await reader.cancel();return;}
      const {value,done}=await reader.read();
      if(done)break;
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  if(!shouldContinue())return;
  const safe=String(filename||view).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,80);
  downloadReportBlob(new Blob(chunks,{type:'text/csv;charset=utf-8;'}),`${safe}_${range.from}_${range.to}.csv`);
}
