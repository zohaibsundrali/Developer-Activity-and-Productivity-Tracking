import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({failed:null}));
vi.mock('@/utils/orgContext',()=>({getOrgId:()=> 'org',getOrgContext:()=>({})}));
vi.mock('@/utils/notifications',()=>({notify:vi.fn(),windowedDedupeKey:vi.fn()}));
vi.mock('@/utils/authFetch',()=>({authFetch:vi.fn()}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{from(table){
 const q={select:()=>q,eq:()=>q,order:()=>q,range:()=>q,then(resolve){return Promise.resolve(table===state.failed?{data:null,error:new Error('read denied')}:{data:[],error:null}).then(resolve);}};
 return q;
}}}));
import { loadSprints, loadEpics, loadAgile } from '@/utils/pmData';
beforeEach(()=>{state.failed=null;});
it.each([['sprints',loadSprints],['epics',loadEpics]])('does not display denied %s reads as an empty list',async(table,load)=>{
 state.failed=table; await expect(load('project')).rejects.toThrow('read denied');
});
it('propagates task failure through the combined planning load',async()=>{
 state.failed='developer_tasks'; await expect(loadAgile('project')).rejects.toThrow('read denied');
});
it('retains a legitimate empty planning result',async()=>{
 await expect(loadAgile('project')).resolves.toEqual({sprints:[],epics:[],tasks:[]});
});
