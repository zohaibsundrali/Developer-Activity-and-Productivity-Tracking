import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({}));
vi.mock('@/utils/orgContext',()=>({getOrgId:()=>state.org,getOrgContext:()=>({userId:'owner'})}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{from:()=>{
 const q={update:value=>(state.payload=value,q),delete:()=>q,insert:value=>(state.payload=value,q),eq:(key,value)=>(state.filters.push([key,value]),q),select:()=>q,order:()=>q,single:()=>q,then:resolve=>Promise.resolve(state.result).then(resolve)};return q;
}}}));
import {loadSavedViews,saveView,deleteView} from '@/utils/pmData';
beforeEach(()=>Object.assign(state,{org:'org',filters:[],result:{data:[{id:'view'}],error:null}}));
it('surfaces saved-view loading failures instead of showing an empty list',async()=>{
 state.result={data:null,error:new Error('Unavailable')};await expect(loadSavedViews('project')).rejects.toThrow('Unavailable');
});
it.each([saveView.bind(null,'project',{id:'view',name:'View'}),deleteView.bind(null,'view')])('does not report successful writes when RLS or a stale ID affects no rows',async mutate=>{
 state.result={data:[],error:null};expect((await mutate()).error.message).toMatch(/not saved|not deleted/);
 expect(state.filters).toEqual([['organization_id','org'],['id','view']]);
});
it('confirms the exact view before reporting a successful update',async()=>{
 expect((await saveView('project',{id:'view',name:'View'})).error).toBeNull();
 state.result={data:[{id:'different'}],error:null};expect((await deleteView('view')).error).toBeTruthy();
});
it('preserves database errors and prevents context-free writes',async()=>{
 state.result={error:{message:'Denied'}};expect((await deleteView('view')).error.message).toBe('Denied');
 state.org=null;state.filters=[];expect((await saveView('project',{id:'view',name:'View'})).error).toBeTruthy();expect(state.filters).toEqual([]);
});

it('translates the persisted board type to the Kanban tab on reload',async()=>{
 state.result={data:[{id:'view',view_type:'board',config:{}}],error:null};
 expect((await loadSavedViews('project'))[0].view_type).toBe('kanban');
});
it.each(['kanban','list','table','calendar','timeline','workload'])('persists %s using the live database view-type contract',async type=>{
 await saveView('project',{name:'View',view_type:type});
 expect(state.payload.view_type).toBe(type==='kanban'?'board':type);
 await saveView('project',{id:'view',name:'View',view_type:type});
 expect(state.payload.view_type).toBe(type==='kanban'?'board':type);
});
