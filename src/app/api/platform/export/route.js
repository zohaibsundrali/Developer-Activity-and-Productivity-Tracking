import { requirePlatformPermission, platformJson } from '@/utils/platformOwner';
import { platformFilters, applyPlatformFilters } from '@/utils/platformFilters';
import { PLATFORM_EXPORTS, platformCsv } from '@/utils/platformExports';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_ROWS = 10000;
export async function GET(request) {
  try {
    const search = new URL(request.url).searchParams;
    const dataset = search.get('dataset'), format = search.get('format') || 'csv';
    const config = PLATFORM_EXPORTS[dataset];
    if (!Object.hasOwn(PLATFORM_EXPORTS,dataset || '') || !['csv','pdf'].includes(format)) return platformJson({error:'Choose a supported dataset and CSV or PDF format.'},400);
    const access = await requirePlatformPermission(request,config.permission); if (access.error) return access.error;
    const filters = platformFilters(search);
    if (!filters) return platformJson({error:'Invalid export filters.'},400);
    const rows=[];
    const seen = new Set();
    let total;
    // Fetch every matching page; do not silently export only the visible page
    // or Supabase's first 1,000 rows. Cap large exports with an explicit error.
    for(let offset=0; ;offset+=500) {
      let query = access.svc.from(config.table).select(config.columns,{count:'exact'});
      query = applyPlatformFilters(query,filters,config);
      const result = await query.order('created_at',{ascending:false}).order('id').range(offset,offset+499);
      if(result.error || !Array.isArray(result.data)) return platformJson({error:'Export data unavailable.'},503);
      if (!Number.isSafeInteger(result.count) || result.count < 0 || (total !== undefined && result.count !== total)) return platformJson({error:'Export records changed or could not be counted. Please retry.'},503);
      total=result.count;
      if(total>MAX_ROWS || rows.length+result.data.length>MAX_ROWS) return platformJson({error:'This export exceeds 10,000 rows. Narrow the date range or organization filter.'},422);
      for (const row of result.data) {
        if (row?.id == null || seen.has(row.id)) return platformJson({error:'Export records changed. Please retry.'},503);
        seen.add(row.id);
      }
      rows.push(...result.data);
      if (rows.length > total || (result.data.length < 500 && rows.length < total)) return platformJson({error:'Export data is incomplete. Please retry.'},503);
      if(rows.length === total) break;
    }
    const columns=config.columns.split(',');
    let body, contentType;
    if(format==='csv') { body=platformCsv(columns,rows); contentType='text/csv; charset=utf-8'; }
    else {
      const [{jsPDF},{default:autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
      const doc=new jsPDF({orientation:'landscape'});
      doc.setFontSize(17);doc.text(`Verisade — ${dataset}`,14,16);
      doc.setFontSize(9);doc.text(`Generated ${new Date().toISOString()} | ${rows.length} records | UTC dates`,14,23);
      autoTable(doc,{startY:29,head:[columns],body:rows.map(row=>columns.map(column=>row[column]==null?'':String(row[column]))),styles:{fontSize:7,overflow:'linebreak'},headStyles:{fillColor:[43,55,83]},margin:{left:10,right:10},didDrawPage:({pageNumber})=>{doc.setFontSize(8);doc.text(`Page ${pageNumber}`,275,202);}});
      body=doc.output('arraybuffer');contentType='application/pdf';
    }
    return new Response(body,{headers:{'Content-Type':contentType,'Content-Disposition':`attachment; filename="verisade-${dataset}-${new Date().toISOString().slice(0,10)}.${format}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch {return platformJson({error:'Export could not be generated.'},503);}
}
