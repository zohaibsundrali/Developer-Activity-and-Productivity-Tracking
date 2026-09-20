import { describe,it,expect,vi,beforeEach } from 'vitest';
import { csvCell,platformCsv } from '@/utils/platformExports';
import { platformFilters,applyPlatformFilters } from '@/utils/platformFilters';
const mocks=vi.hoisted(()=>({guard:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/utils/platformOwner',()=>({requirePlatformPermission:mocks.guard,platformJson:(body,status=200)=>Response.json(body,{status}),platformPage:search=>Number(search.get('page')||1)}));
const project=await import('@/app/api/platform/projects/[id]/route');
const exports=await import('@/app/api/platform/export/route');
const id='11111111-1111-4111-8111-111111111111';
const request=(path,body)=>new Request(`http://localhost/${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
beforeEach(()=>{vi.clearAllMocks();mocks.guard.mockResolvedValue({svc:{rpc:mocks.rpc,from:mocks.from},args:{p_auth:'actor',p_session:'session'}});mocks.rpc.mockResolvedValue({data:{action:'archive'}});});
describe('project actions',()=>{
 it('passes the verified actor and validates exact-name deletion',async()=>{
  expect((await project.POST(request('',{action:'delete',reason:'Remove fixture'}),{params:Promise.resolve({id})})).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  await project.POST(request('',{action:'archive',reason:'Archive fixture',p_auth:'forged'}),{params:Promise.resolve({id})});
  expect(mocks.rpc).toHaveBeenCalledWith('platform_project_action',{p_auth:'actor',p_session:'session',p_project:id,p_action:'archive',p_reason:'Archive fixture',p_name:null});
 });
 it('does not mutate when access denied',async()=>{mocks.guard.mockResolvedValue({error:Response.json({}, {status:403})});expect((await project.POST(request('',{action:'archive',reason:'Archive fixture'}),{params:Promise.resolve({id})})).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('surfaces protected database dependencies as conflict',async()=>{mocks.rpc.mockResolvedValue({error:{code:'23503'}});expect((await project.POST(request('',{action:'delete',reason:'Remove fixture',confirmName:'Test'}),{params:Promise.resolve({id})})).status).toBe(409);});
});
describe('exports',()=>{
 it.each(['=HYPERLINK("bad")',' +CMD','\t@SUM(1)','-1'])('neutralizes spreadsheet formulas %s',value=>expect(csvCell(value)).toMatch(/^"'/));
 it('escapes quotes and keeps rows intact',()=>expect(platformCsv(['name'],[{name:'a,"b"\nc'}])).toBe('\ufeff"name"\r\n"a,""b""\nc"'));
 it('rejects invalid dates, inverted dates and invalid organizations',()=>{
  for(const value of ['from=2026-02-30','from=2026-12-01&to=2026-01-01','organizationId=oops']) expect(platformFilters(new URLSearchParams(value))).toBeNull();
 });
 it('uses inclusive UTC end date and literal search',()=>{const q={lt:vi.fn().mockReturnThis(),gte:vi.fn().mockReturnThis(),ilike:vi.fn().mockReturnThis()};applyPlatformFilters(q,{from:'2026-01-01',to:'2026-01-31',search:'100%'},{searchColumn:'name'});expect(q.lt).toHaveBeenCalledWith('created_at','2026-02-01T00:00:00.000Z');expect(q.ilike).toHaveBeenCalledWith('name','%100\\%%');});
 it('rejects inherited object dataset names',async()=>expect((await exports.GET(request('?dataset=constructor'))).status).toBe(400));
 it('fetches all pages past the REST row cap and supplies CSV download headers',async()=>{
  const query={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn()};
  query.range.mockResolvedValueOnce({data:Array.from({length:500},(_,i)=>({id:i,name:'first'})),count:501}).mockResolvedValueOnce({data:[{id:500,name:'last'}],count:501});mocks.from.mockReturnValue(query);
  const response=await exports.GET(request('?dataset=organizations'));
  expect(response.status).toBe(200);expect(query.range.mock.calls).toEqual([[0,499],[500,999]]);expect(await response.text()).toContain('last');expect(response.headers.get('content-disposition')).toContain('.csv');
 });
 it('generates an actual PDF download',async()=>{const query={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValue({data:[{id:'one',name:'Report fixture'}],count:1})};mocks.from.mockReturnValue(query);const response=await exports.GET(request('?dataset=organizations&format=pdf'));expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('application/pdf');expect((await response.text()).slice(0,5)).toBe('%PDF-');});
 it('does not silently truncate oversized exports',async()=>{const query={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValue({data:[],count:10001})};mocks.from.mockReturnValue(query);expect((await exports.GET(request('?dataset=organizations'))).status).toBe(422);});
});
