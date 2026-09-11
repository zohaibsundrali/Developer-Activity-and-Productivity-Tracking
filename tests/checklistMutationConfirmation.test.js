import { beforeEach,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({}));
vi.mock('@/utils/orgContext',()=>({getOrgId:()=>state.org,getOrgContext:()=>({})}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{from:()=>{
 const q={update:()=>q,eq:(k,v)=>(state.filters.push([k,v]),q),select:async()=>state.result};return q;
}}}));
import {toggleChecklistItem} from '@/utils/pmData';
beforeEach(()=>Object.assign(state,{org:'org',filters:[],result:{data:[{id:'item'}],error:null}}));
it('confirms the requested organization item before reporting success',async()=>{
 expect(await toggleChecklistItem('item',true)).toEqual({error:null});
 expect(state.filters).toEqual([['organization_id','org'],['id','item']]);
});
it.each([[],[{id:'different'}]])('reports refused or mismatched mutation',async data=>{
 state.result={data,error:null};expect((await toggleChecklistItem('item',true)).error.message).toContain('not changed');
});
it('preserves database failure and refuses missing organization',async()=>{
 state.result={error:{message:'locked'}};expect((await toggleChecklistItem('item',true)).error).toEqual({message:'locked'});
 state.org=null;expect((await toggleChecklistItem('item',true)).error.message).toContain('Organization');
});
