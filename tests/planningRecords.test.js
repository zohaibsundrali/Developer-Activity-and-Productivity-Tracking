import { describe, expect, it, vi } from 'vitest';
import { planningPatch, savePlanningRecord } from '@/utils/planningRecords';
function client(result) {
 const calls=[];
 const q={update:value=>{calls.push(['update',value]);return q;},insert:value=>{calls.push(['insert',value]);return q;},eq:(...args)=>{calls.push(['eq',...args]);return q;},is:(...args)=>{calls.push(['is',...args]);return q;},select:()=>q,maybeSingle:async()=>result};
 return {from:vi.fn(()=>q),calls};
}
describe('confirmed planning saves',()=>{
 it.each(['sprints','epics'])('reports a zero-row %s update as failure',async table=>{
  const db=client({data:null,error:null}); const result=await savePlanningRecord(db,'org',table,'project',{id:'record',name:'Draft'});
  expect(result.error.message).toContain('Nothing was saved');
  expect(db.calls).toContainEqual(['eq','organization_id','org']); expect(db.calls).toContainEqual(['eq','project_id','project']);
 });
 it('returns the confirmed saved record and restricts global container updates',async()=>{
  const db=client({data:{id:'record',name:'Saved'},error:null});
  expect(await savePlanningRecord(db,'org','epics',null,{id:'record',name:' Saved '})).toEqual({epic:{id:'record',name:'Saved'},error:null});
  expect(db.calls).toContainEqual(['is','project_id',null]); expect(db.calls).toContainEqual(['update',{name:'Saved'}]);
 });
 it('does not allow payload identity fields to override the verified scope',async()=>{
  const db=client({});
  for(const field of ['organization_id','project_id','created_by','created_at']) {
   expect((await savePlanningRecord(db,'org','sprints','project',{name:'Sprint',[field]:'other'})).error).toBeTruthy();
  }
  expect(db.from).not.toHaveBeenCalled();
 });
 it('sets scope on inserts and preserves schema-supported statuses',async()=>{
  const db=client({data:{id:'new'},error:null});
  expect((await savePlanningRecord(db,'org','sprints','project',{name:' Sprint ',status:'completed',start_date:'',end_date:null})).error).toBeNull();
  expect(db.calls).toContainEqual(['insert',{name:'Sprint',status:'completed',start_date:null,end_date:null,organization_id:'org',project_id:'project'}]);
 });
 it('propagates database errors and rejects missing organization before a query',async()=>{
  const error={message:'denied'},db=client({error});
  expect((await savePlanningRecord(db,null,'sprints','project',{name:'Sprint'})).error).toBeTruthy(); expect(db.from).not.toHaveBeenCalled();
  expect((await savePlanningRecord(db,'org','sprints','project',{name:'Sprint'})).error).toBe(error);
 });
 it.each([{name:' '},{name:'Sprint',status:'deleted'},{name:'Sprint',start_date:'2026-02-30'},{name:'Sprint',start_date:'2026-09-12',end_date:'2026-09-11'},{name:'Sprint',sort_order:1.5},{name:'Sprint',goal:{x:1}}])('rejects invalid values %j',patch=>{
  expect(()=>planningPatch('sprints',patch)).toThrow();
 });
});
