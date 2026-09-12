import { prepareReport, readDatabaseReport, reportJson, reportFailure } from '@/utils/serverReports';
export const dynamic = 'force-dynamic';
export async function GET(request){
  try{
    const context=await prepareReport(request);
    if(context.response)return context.response;
    return reportJson(await readDatabaseReport(context));
  }catch(error){return reportFailure(error);}
}
