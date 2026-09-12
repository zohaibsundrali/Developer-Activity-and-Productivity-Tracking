import { prepareReport, readDatabaseReport, reportFailure, reportRowKey } from '@/utils/serverReports';
import { REPORT_COLUMNS } from '@/utils/reportColumns';
import { csvRow } from '@/utils/csvSerialization';
export const dynamic='force-dynamic';
export async function GET(request){
  try{
    const context=await prepareReport(request,{exporting:true});
    if(context.response)return context.response;
    const first=await readDatabaseReport(context);
    const columns=REPORT_COLUMNS[context.view],encoder=new TextEncoder();
    const total=first.total;
    let page=first,initial=true,cancelled=false;
    const seenKeys=new Set();
    const stop=new AbortController();
    const disconnect=()=>stop.abort();
    request.signal.addEventListener('abort',disconnect,{once:true});
    if(request.signal.aborted)stop.abort();
    context.signal=stop.signal;
    const cleanup=()=>request.signal.removeEventListener('abort',disconnect);
    const stream=new ReadableStream({
      async pull(controller){
        if(cancelled)return;
        if(stop.signal.aborted){cleanup();controller.error(new Error('Report export cancelled'));return;}
        try{
          if(!initial){
            page=await readDatabaseReport(context,page.nextOffset);
            if(page.total!==total)throw new Error('Report changed during export');
          }
          const rows=context.view==='overview'?page.trend.days.map((date,i)=>({date,completed:page.trend.completed[i],loggedHours:page.trend.loggedHours[i],trackedHours:page.trend.trackedHours[i]})):page.rows;
          if(context.view!=='overview'){
            const keys=rows.map(row=>reportRowKey(row,context.view));
            if(keys.some(key=>seenKeys.has(key)))throw new Error('Report changed during export');
            keys.forEach(key=>seenKeys.add(key));
          }
          if(cancelled)return;
          if(stop.signal.aborted)throw new Error('Report export cancelled');
          const prefix=initial?'\ufeff'+csvRow(columns.map(c=>c.label))+'\r\n':'';
          controller.enqueue(encoder.encode(prefix+rows.map(row=>csvRow(columns.map(c=>row[c.key]))+'\r\n').join('')));
          initial=false;
          if(context.view==='overview'||page.nextOffset===null){cleanup();controller.close();}
        }catch{cleanup();if(!cancelled)controller.error(new Error('Report export could not complete. Please retry.'));}
      },
      cancel(){cancelled=true;stop.abort();cleanup();},
    });
    return new Response(stream,{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment; filename="${context.view}_${context.range.from}_${context.range.to}.csv"`,'Cache-Control':'private, no-store',Vary:'Authorization, Cookie','X-Content-Type-Options':'nosniff'}});
  }catch(error){return reportFailure(error);}
}
