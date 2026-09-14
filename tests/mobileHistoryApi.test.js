import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({auth:null,context:null,result:null,filters:[],client:null}));
vi.mock('@/utils/mobileServer',()=>({
 mobileAuth:async()=>({auth:h.auth,client:h.client}),readMobileContext:async()=>({data:h.context}),
 mobileReply:data=>Response.json(data),mobileFail:(error,status=400)=>Response.json({error},{status}),mobileDatabaseError:()=>Response.json({error:'unavailable'},{status:503})
}));
const { GET }=await import('@/app/api/mobile/history/route');
const org='99100000-0000-0000-0000-000000000001',user='99100000-0000-0000-0000-000000000011',id='99100000-0000-0000-0000-000000000012';
const row=()=>({id,organization_id:org,user_id:user,user_type:'developer',started_at:'2026-09-14T09:00:00Z',ended_at:'2026-09-14T09:01:00Z',work_seconds:60});
const get=(extra='')=>GET(new Request('https://app.test/api/mobile/history?from=2026-09-14&to=2026-09-14'+extra));
beforeEach(()=>{h.auth={orgId:org,appUserId:user,userType:'developer'};h.context={can_view_all:false,sites:[]};h.filters=[];h.result={data:[row()],count:1};const query={then:resolve=>Promise.resolve(h.result).then(resolve)};for(const name of ['select','eq','gte','lt','order','limit','or','maybeSingle'])query[name]=(...args)=>{h.filters.push([name,...args]);return query;};h.client={from:()=>query};});
it('binds own history to both profile ID and profile type',async()=>{expect((await get()).status).toBe(200);expect(h.filters).toContainEqual(['eq','user_id',user]);expect(h.filters).toContainEqual(['eq','user_type','developer']);h.result.data[0].user_type='admin';expect((await get()).status).toBe(503);});
it('refuses wide history without monitoring access',async()=>{expect((await get('&scope=all')).status).toBe(403);expect(h.filters).toEqual([]);});
it('continues after a low server row cap and binds the cursor to its viewer',async()=>{h.result.count=3;const response=await (await get()).json();expect(response.nextCursor).toBeTruthy();h.auth.userType='admin';expect((await get('&cursor='+response.nextCursor)).status).toBe(400);});
it('rejects duplicate or out-of-order database receipts',async()=>{h.result={data:[row(),row()],count:2};expect((await get()).status).toBe(503);});
it('checks detail ownership independently of row-level filtering',async()=>{h.result={data:{...row(),user_type:'admin'}};expect((await get('&id='+id)).status).toBe(503);});
it('labels validated detail samples against current work sites',async()=>{h.result={data:{...row(),payload:{id,recovered:false,segments:[{id,start:row().started_at,end:row().ended_at}],points:[{at:'2026-09-14T09:00:30Z',lat:31,lon:74,accuracy:10,mock:false}]}}};const response=await get('&id='+id);expect(response.status).toBe(200);expect((await response.json()).geofence_basis).toBe('current_work_sites');});
