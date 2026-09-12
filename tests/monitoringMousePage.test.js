import { describe, expect, it, vi } from 'vitest';
import { loadMonitoringMousePage } from '@/utils/monitoringMousePage';
const org='10000000-0000-4000-8000-000000000001', dev='20000000-0000-4000-8000-000000000001';
const opts={organizationId:org,developerIds:[dev],start:'2026-09-12T00:00:00Z',end:'2026-09-13T00:00:00Z'};
const row=id=>({id,organization_id:org,developer_id:dev,timestamp:'2026-09-12T09:00:00Z'});
function database(count, pages=[], onRead=()=>{}){
 const calls=[];const client={from:table=>{
  const call={table,filters:[],orders:[]};calls.push(call);const q={select:(fields,options)=>{call.options=options;return q;},
   eq:(...args)=>{call.filters.push(['eq',...args]);return q;},in:(...args)=>{call.filters.push(['in',...args]);return q;},gte:(...args)=>{call.filters.push(['gte',...args]);return q;},lt:(...args)=>{call.filters.push(['lt',...args]);return q;},
   order:(...args)=>{call.orders.push(args);return q;},range:(...args)=>{call.range=args;return q;},
   then:resolve=>{onRead(call);return Promise.resolve(call.options.head?{count,error:null}:pages.shift()).then(resolve);}};return q;
 }};return{client,calls};
}
describe('complete scoped mouse UI pages',()=>{
 it('fills a page across low hosted caps with stable timestamp/id order',async()=>{
  const db=database(5,[{data:[row(5),row(4)],count:5},{data:[row(3),row(2)],count:5},{data:[row(1)],count:5}]);
  const result=await loadMonitoringMousePage(db.client,opts);expect(result.rows.map(r=>r.id)).toEqual([5,4,3,2,1]);expect(result.total).toBe(5);
  expect(db.calls.filter(c=>c.range).map(c=>c.range)).toEqual([[0,4],[2,4],[4,4]]);
  for(const c of db.calls){expect(c.filters).toEqual([['eq','organization_id',org],['in','developer_id',[dev]],['gte','timestamp',opts.start],['lt','timestamp',opts.end]]);}
  expect(db.calls[1].orders).toEqual([['timestamp',{ascending:false}],['id',{ascending:false}]]);
 });
 it('fills the requested UI page rather than starting at zero',async()=>{
  const db=database(53,[{data:[row(3),row(2)],count:53},{data:[row(1)],count:53}]);
  expect((await loadMonitoringMousePage(db.client,{...opts,page:2})).rows).toHaveLength(3);
  expect(db.calls[1].range).toEqual([50,52]);expect(db.calls[2].range).toEqual([52,52]);
 });
 it.each([0,50])('handles deleted/out-of-range page with total %s without an invalid range request',async total=>{
  const db=database(total);expect(await loadMonitoringMousePage(db.client,{...opts,page:2})).toEqual({rows:[],total});expect(db.calls).toHaveLength(1);
 });
 it.each([
  {pages:[{data:[row(1)],count:3}]},
  {pages:[{data:[],count:2}]},
  {pages:[{data:[row(1),row(2),row(3)],count:2}]},
  {pages:[{data:[row(1)],count:2},{data:[row('1')],count:2}]},
  {pages:[{data:[{...row(1),id:null}],count:2}]},
  {pages:[{data:null,count:2,error:{message:'internal'}}]},
  {pages:[{data:[{...row(1),organization_id:'other'}],count:2}]},
  {pages:[{data:[{...row(1),timestamp:opts.end}],count:2}]},
 ])('rejects partial, changing, duplicate or unscoped rows %#',async({pages})=>{
  const db=database(2,pages);await expect(loadMonitoringMousePage(db.client,opts)).rejects.toThrow('completely');
 });
 it.each([null,-1,1.5,'2'])('refuses unavailable exact count %j',async total=>{
  const db=database(total);await expect(loadMonitoringMousePage(db.client,opts)).rejects.toThrow('completely');expect(db.calls).toHaveLength(1);
 });
 it.each([{developerIds:[]},{developerIds:['injected']},{organizationId:''},{page:0},{page:1.5},{pageSize:51},{start:'2026-02-30'},{end:opts.start}])('validates scope and paging before querying %j',async patch=>{
  const db=database(0);await expect(loadMonitoringMousePage(db.client,{...opts,...patch})).rejects.toThrow('Invalid');expect(db.calls).toHaveLength(0);
 });
 it('deduplicates identical developer selectors',async()=>{
  const db=database(0);await loadMonitoringMousePage(db.client,{...opts,developerIds:[dev,dev]});expect(db.calls[0].filters[1]).toEqual(['in','developer_id',[dev]]);
 });
 it('discards stale responses and never loads the next chunk',async()=>{
  let active=true;const db=database(2,[{data:[row(1)],count:2}],c=>{if(!c.options.head)active=false;});
  expect(await loadMonitoringMousePage(db.client,opts,()=>active)).toBeNull();expect(db.calls).toHaveLength(2);
 });
 it('does nothing when already stale',async()=>{
  const db=database(0);expect(await loadMonitoringMousePage(db.client,opts,()=>false)).toBeNull();expect(db.calls).toHaveLength(0);
 });
});
