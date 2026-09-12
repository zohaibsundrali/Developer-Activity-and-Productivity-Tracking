import { describe, it, expect, vi } from 'vitest';
import { loadMonitoringRoster } from '@/utils/monitoringRoster';
function fixture(pages) {
 const q={then:resolve=>Promise.resolve(pages.shift()).then(resolve)};
 for(const name of ['select','eq','order','range']) q[name]=vi.fn(()=>q);
 const client={from:vi.fn(()=>q)};return {client,q};
}
describe('minimal complete monitoring roster',()=>{
 it('pages past a low provider cap and only returns display identity fields',async()=>{
  const {client,q}=fixture([{data:[{id:'a',name:'A',email:'a@example.test',password:'should-not-propagate'}],count:2},{data:[{id:'b',name:'B'}],count:2}]);
  const rows=await loadMonitoringRoster(client,'org');expect(rows).toEqual([{id:'a',name:'A',email:'a@example.test'},{id:'b',name:'B',email:undefined}]);
  expect(q.select).toHaveBeenCalledWith('id, name, email',{count:'exact'});expect(q.eq).toHaveBeenCalledWith('organization_id','org');expect(q.range.mock.calls).toEqual([[0,499],[1,500]]);
 });
 it('requires a verified organization before any query',async()=>{const {client}=fixture([]);await expect(loadMonitoringRoster(client,null)).rejects.toThrow();expect(client.from).not.toHaveBeenCalled();});
 it('returns a confirmed empty roster',async()=>{const {client}=fixture([{data:[],count:0}]);expect(await loadMonitoringRoster(client,'org')).toEqual([]);});
 it.each([
  [{data:[{id:'a'}],count:2},{data:[{id:'b'}],count:3}],
  [{data:[{id:'a'}],count:2},{data:[{id:'a'}],count:2}],
  [{data:[],count:2}], [{data:[{}],count:1}], [{data:[{id:'a'}],count:null}],
  [{data:[{id:'a'}],count:0}], [{data:null,error:{message:'internal secret'}}]
 ].map(pages=>({pages})))('fails malformed or changed pages %#',async ({pages})=>{const {client}=fixture([...pages]);await expect(loadMonitoringRoster(client,'org')).rejects.toThrow(/roster/);});
 it('stops after a scope change without displaying old results',async()=>{let active=true;const {client,q}=fixture([]);q.then=resolve=>{active=false;return Promise.resolve({data:[{id:'a'}],count:1}).then(resolve);};expect(await loadMonitoringRoster(client,'org',()=>active)).toBeNull();});
 it('does not start when the view is already stale',async()=>{const {client}=fixture([]);expect(await loadMonitoringRoster(client,'org',()=>false)).toBeNull();expect(client.from).not.toHaveBeenCalled();});
});
