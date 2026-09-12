import { describe,it,expect,vi,beforeEach } from 'vitest';
const m=vi.hoisted(()=>({auth:null,denied:null,feature:null,rpc:vi.fn()}));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>m.auth,getBearerToken:()=> 'caller-token',orgScopedClient:vi.fn(()=>({rpc:m.rpc})),serviceClient:()=>({billingOnly:true})}));
vi.mock('@/utils/serverPermissions',()=>({requirePermission:()=>m.denied}));
vi.mock('@/utils/entitlements',()=>({checkFeatureAccess:async()=>m.feature}));
import { GET } from '@/app/api/reports/route';
import { GET as CSV } from '@/app/api/reports/export/route';
import { reportRangeDays } from '@/utils/reportDates';
const org='11111111-1111-4111-8111-111111111111';
const range={from:'2026-09-01',to:'2026-09-02'};
const id=i=>`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`;
const req=(extra='',path='reports')=>new Request(`https://app.test/api/${path}?from=${range.from}&to=${range.to}${extra}`);
const overview=()=>({orgId:org,range,view:'overview',kpis:{projects:0,tasks:0,done:0,overdue:0,completionRate:0,loggedHours:0,trackedHours:0},statusCounts:{pending:0,in_progress:0,awaiting_approval:0,completed:0,rejected:0,total:0},trend:{days:reportRangeDays(range),completed:[0,0],loggedHours:[0,0],trackedHours:[0,0]},projectTop:[],teamTop:[],totals:{projects:0,team:0,time:0,delays:0,timedHours:0}});
const page=(view='time',rows=[],total=rows.length,nextOffset=null)=>({orgId:org,range,view,rows,total,nextOffset});
beforeEach(()=>{vi.clearAllMocks();m.rpc.mockReset();m.auth={orgId:org,userType:'admin'};m.denied=null;m.feature=null;m.rpc.mockResolvedValue({data:overview(),error:null});});
describe('aggregate report authority and input',()=>{
  it('requires authentication',async()=>{m.auth=null;expect((await GET(req())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();});
  it('requires effective report permission',async()=>{m.denied=new Response('{}',{status:403});expect((await GET(req())).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
  it.each([402,503])('honors failed plan access %s',async status=>{m.feature={status,error:'denied'};expect((await GET(req())).status).toBe(status);expect(m.rpc).not.toHaveBeenCalled();});
  it.each(['&view=other','&limit=0','&limit=501','&limit=1.5','&offset=-1','&offset=2147483648','&offset=1e3'])('rejects invalid query %s',async query=>{expect((await GET(req(query))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
  it.each(['from=&to=2026-09-01','from=0000-01-01&to=2026-09-01','from=2026-02-30&to=2026-03-01','from=2026-10-01&to=2026-09-01','from=2020-01-01&to=2040-01-01'])('rejects invalid range %s',async query=>{expect((await GET(new Request(`https://app.test/api/reports?${query}`))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
  it('uses caller RPC, never accepts a supplied organization',async()=>{expect((await GET(req('&organizationId=foreign'))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('report_data',{p_from:range.from,p_to:range.to,p_view:'overview',p_limit:50,p_offset:0});});
  it.each([['42501','REPORT_FORBIDDEN',403],['42501','REPORT_PLAN_REQUIRED',402],['22023','REPORT_INPUT_INVALID',400],['XX000','secret database detail',503]])('sanitizes RPC failures %s %s',async(code,message,status)=>{m.rpc.mockResolvedValue({data:null,error:{code,message}});const res=await GET(req());expect(res.status).toBe(status);expect(await res.text()).not.toContain('secret');});
});
describe('aggregate receipt verification',()=>{
  it.each(['projects','team','time','delays'])('accepts complete empty %s page',async view=>{m.rpc.mockResolvedValue({data:page(view),error:null});expect((await GET(req(`&view=${view}`))).status).toBe(200);});
  it('accepts >20000 rows total without returning raw sources',async()=>{m.rpc.mockResolvedValue({data:page('time',[{id:id(1),hours:1}],25000,1)});const res=await GET(req('&view=time&limit=1'));expect(res.status).toBe(200);expect((await res.json()).total).toBe(25000);});
  it.each([{orgId:'foreign'},{range:{from:'2020-01-01',to:'2020-01-02'}},{view:'team'},{trend:{days:[],completed:[],loggedHours:[],trackedHours:[]}}, {statusCounts:{pending:0,in_progress:0,awaiting_approval:0,completed:2,total:2}}])('rejects mismatched overview %j',async patch=>{m.rpc.mockResolvedValue({data:{...overview(),...patch}});expect((await GET(req())).status).toBe(503);});
  it.each([page('time',[{id:id(1)},{id:id(1)}]),page('time',[{id:'bad'}]),page('time',[{id:id(1)}],50,null),page('time',[],1,1)])('rejects malformed page %j',async data=>{m.rpc.mockResolvedValue({data});expect((await GET(req('&view=time'))).status).toBe(503);});
  it('sets private response headers',async()=>{const res=await GET(req());expect(res.headers.get('cache-control')).toBe('private, no-store');expect(res.headers.get('vary')).toBe('Authorization, Cookie');});
});
describe('streamed full-report CSV',()=>{
  it('streams every row across pages with formula protection',async()=>{
    const rows=Array.from({length:500},(_,i)=>({id:id(i),developer:i===0?'=1+1':'A',hours:1}));
    m.rpc.mockResolvedValueOnce({data:page('time',rows,501,500)}).mockResolvedValueOnce({data:page('time',[{id:id(500),developer:'Final',hours:2}],501,null)});
    const res=await CSV(req('&view=time','reports/export'));expect(res.status).toBe(200);const text=await res.text();expect(text).toContain('"\'=1+1"');expect(text).toContain('Final');expect(text.trim().split('\r\n')).toHaveLength(502);
    expect(m.rpc.mock.calls[1][1].p_offset).toBe(500);expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
  it('returns a normal failure before streaming if first query fails',async()=>{m.rpc.mockResolvedValue({error:{code:'42501',message:'REPORT_FORBIDDEN'}});expect((await CSV(req('&view=time'))).status).toBe(403);});
  it.each(['count','query','duplicate'])('fails the body instead of silently finishing partial CSV after %s change',async mode=>{
    const rows=Array.from({length:500},(_,i)=>({id:id(i)}));m.rpc.mockResolvedValueOnce({data:page('time',rows,501,500)});
    m.rpc.mockResolvedValueOnce(mode==='query'?{error:{code:'XX000'}}:{data:page('time',[{id:id(mode==='duplicate'?0:500)}],mode==='count'?502:501,mode==='count'?501:null)});
    const res=await CSV(req('&view=time'));await expect(res.text()).rejects.toThrow();
  });
  it('rejects a repeated identity from a nonadjacent export page',async()=>{
    const rows=start=>Array.from({length:500},(_,i)=>({id:id(start+i)}));
    m.rpc.mockResolvedValueOnce({data:page('time',rows(0),1001,500)})
      .mockResolvedValueOnce({data:page('time',rows(500),1001,1000)})
      .mockResolvedValueOnce({data:page('time',[{id:id(0)}],1001,null)});
    const res=await CSV(req('&view=time'));await expect(res.text()).rejects.toThrow();
  });
  it('exports the overview series with no table RPC loop',async()=>{const res=await CSV(req());expect((await res.text()).split('\r\n').filter(Boolean)).toHaveLength(3);expect(m.rpc).toHaveBeenCalledTimes(1);});
});
