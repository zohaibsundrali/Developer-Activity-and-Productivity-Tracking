import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null,filters:null,error:null,reads:0,token:null,pages:[],ranges:[],orders:[] }));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>state.auth,orgScopedClient:token=>{state.token=token;return {from:()=>{const q={select:()=>q,eq:(k,v)=>{state.filters[k]=v;return q;},or:v=>{state.filters.or=v;return q;},gte:(k,v)=>{state.filters.gte=[k,v];return q;},lt:(k,v)=>{state.filters.lt=[k,v];return q;},order:(...args)=>{state.orders.push(args);return q;},range:(...args)=>{state.ranges.push(args);return q;},then:resolve=>{state.reads++;return Promise.resolve(state.pages.shift() || {data:[],count:0,error:state.error}).then(resolve);}};return q;}};}}));
import { GET } from '../src/app/api/keyboard-stats/route';
const own='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const call=(extra={})=>GET(new Request(`http://localhost/api/keyboard-stats?${new URLSearchParams({start:'2026-09-10',end:'2026-09-12',developerId:other,...extra})}`));
beforeEach(()=>{state.auth={orgId:'org',appUserId:own,userType:'developer',role:'developer',email:'own@example.test',token:'caller-token',overrides:{}};state.filters={};state.error=null;state.reads=0;state.token=null;state.pages=[];state.ranges=[];state.orders=[];});
it('forces own typed identity despite supplied other UUID or injected selectors',async()=>{expect((await call({email:'x),developer_id.not.is.null'})).status).toBe(200);expect(state.filters).toEqual({organization_id:'org',or:`developer_id.eq.${own},and(developer_id.is.null,user_email.eq."own@example.test")`,gte:['tracked_at','2026-09-10T00:00:00.000Z'],lt:['tracked_at','2026-09-12T00:00:00.000Z']});expect(state.token).toBe('caller-token');});
it('denies explicit own-monitoring override',async()=>{state.auth.overrides['monitoring.view_own']=false;expect((await call()).status).toBe(403);expect(state.reads).toBe(0);});
it('denies colliding admin own fallback even if own permission granted',async()=>{state.auth.userType='admin';state.auth.overrides={'monitoring.view':false,'monitoring.view_own':true};expect((await call()).status).toBe(403);expect(state.reads).toBe(0);});
it('allows effective wide monitoring grant using caller RLS',async()=>{state.auth.overrides['monitoring.view']=true;expect((await call({email:'person+tag@example.test'})).status).toBe(200);expect(state.filters.or).toContain(other);expect(state.filters.or).toContain('"person+tag@example.test"');});
it.each([{developerId:'x,developer_id.not.is.null'},{userId:'x.or(y)'},{email:'x@example.test,developer_id.not.is.null'},{email:'x"@example.test'}])('rejects unsafe wide selector %j',async values=>{state.auth.overrides['monitoring.view']=true;expect((await call(values)).status).toBe(400);expect(state.reads).toBe(0);});
it('fails closed for unavailable overrides and client profiles',async()=>{state.auth.overridesUnavailable=true;expect((await call()).status).toBe(503);state.auth.overridesUnavailable=false;state.auth.userType='client';state.auth.overrides['monitoring.view']=true;expect((await call()).status).toBe(403);});
it('sanitizes database errors without service fallback',async()=>{state.error={message:'private schema information'};const res=await call();expect(res.status).toBe(500);expect(JSON.stringify(await res.json())).not.toContain('private');expect(state.reads).toBe(1);});
it('preserves date validation and rejects missing effective selector',async()=>{expect((await call({start:'invalid'})).status).toBe(400);state.auth.overrides['monitoring.view']=true;state.auth.userType='admin';expect((await call({developerId:'null'})).status).toBe(400);expect(state.reads).toBe(0);});

it('defaults wide monitoring developer profiles to own identity when no target is supplied',async()=>{state.auth.overrides['monitoring.view']=true;expect((await call({developerId:''})).status).toBe(200);expect(state.filters.or).toContain(own);expect(state.filters.or).not.toContain(other);});

it('loads all report rows even when the provider cap is below the requested page size',async()=>{
 state.pages=[{data:[{id:3},{id:2}],count:3,error:null},{data:[{id:1}],count:3,error:null}];
 const res=await call(); const body=await res.json();
 expect(res.status).toBe(200);expect(body.data.map(r=>r.id)).toEqual([3,2,1]);expect(body.truncated).toBe(false);
 expect(state.ranges).toEqual([[0,499],[2,501]]);expect(state.orders).toContainEqual(['id',{ascending:false}]);
});
it('marks bounded results as partial instead of claiming a complete report',async()=>{
 state.pages=Array.from({length:20},(_,i)=>({data:[{id:i}],count:21,error:null}));
 const body=await (await call()).json();expect(body.count).toBe(20);expect(body.availableCount).toBe(21);expect(body.truncated).toBe(true);expect(state.reads).toBe(20);
});
it('discards an incomplete report when a later page fails',async()=>{
 state.pages=[{data:[{id:1}],count:2,error:null},{data:null,count:null,error:{message:'private database error'}}];
 const res=await call();expect(res.status).toBe(500);const body=await res.json();expect(body.data).toEqual([]);expect(JSON.stringify(body)).not.toContain('private');
});
it('does not claim completeness without an exact authorized count',async()=>{
 state.pages=[{data:[{id:1}],count:null,error:null}];expect((await call()).status).toBe(500);
});

it.each([
 [{data:[{id:1}],count:2},{data:[{id:2}],count:3}],
 [{data:[{id:1}],count:2},{data:[{id:'1'}],count:2}],
 [{data:[{id:1}],count:2},{data:[],count:2}],
 [{data:[{id:1},{id:2}],count:1}],
 [{data:[{}],count:1}],
 [{data:[{id:null}],count:1}],
 [{data:[{id:1.5}],count:1}],
 [{data:[{id:''}],count:1}],
 [{data:Array.from({length:501},(_,id)=>({id})),count:501}],
].map(pages=>({pages})))('rejects invalid or drifting page sequence %# without returning partial records',async ({pages})=>{
 state.pages=pages;const res=await call();expect(res.status).toBe(500);expect((await res.json()).data).toEqual([]);
});
it.each(['2026-02-30','2026-09-31T10:00:00Z','2026-09-11T24:00:00Z','2026-09-11T12:61:00Z','09/11/2026','2026-09-11garbage'])('rejects impossible or unsupported calendar input %s',async start=>{
 expect((await call({start})).status).toBe(400);expect(state.reads).toBe(0);
});
it('preserves valid ISO offsets and uses an exclusive end bound',async()=>{
 expect((await call({start:'2026-09-10T10:30:00+02:00',end:'2026-09-10T11:30:00+02:00'})).status).toBe(200);
 expect(state.filters.gte).toEqual(['tracked_at','2026-09-10T08:30:00.000Z']);expect(state.filters.lt).toEqual(['tracked_at','2026-09-10T09:30:00.000Z']);
});
it('restricts email fallback to missing developer identity when a UUID is requested',async()=>{
 state.auth.overrides['monitoring.view']=true;await call({email:'reused@example.test'});
 expect(state.filters.or).toBe(`developer_id.eq.${other},and(developer_id.is.null,user_email.eq."reused@example.test")`);
});
it('preserves explicitly requested email-only monitoring queries',async()=>{
 state.auth.userType='admin';state.auth.role='owner';await call({developerId:'',email:'person@example.test'});
 expect(state.filters.or).toBe('user_email.eq."person@example.test"');
});
it.each([200,401,403,400,500])('keeps response status %s private and uncached',async status=>{
 if(status===401)state.auth=null;
 if(status===403)state.auth.overrides['monitoring.view_own']=false;
 if(status===500)state.error={message:'private error'};
 const res=await call(status===400?{start:'bad'}:{});expect(res.status).toBe(status);
 expect(res.headers.get('cache-control')).toContain('private');expect(res.headers.get('cache-control')).toContain('no-store');expect(res.headers.get('vary')).toBe('Authorization, Cookie');
});
