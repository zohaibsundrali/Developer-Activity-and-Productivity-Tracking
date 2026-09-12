import { beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({}));
vi.mock('@/utils/orgContext',()=>({getOrgContext:()=>null}));
vi.mock('@/utils/authFetch',()=>({authFetch: (...args)=>state.request(...args)}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{from:table=>{
 state.tables.push(table);let inserting=false;
 const q={select:()=>q,eq:()=>q,ilike:async()=>({data:state.existing}),insert:payload=>{state.inserts.push(payload);inserting=true;return q;},delete:()=>{throw new Error('Unexpected compensation delete');},then:resolve=>Promise.resolve({data:inserting?[{id:'profile-a',email:'person@example.test',name:'Test Person'}]:[]}).then(resolve)};return q;
}}}));
import {createStaffMember} from '@/utils/staffAccounts';
const input={orgId:'org-a',actor:{id:'owner'},name:'Test Person',email:'person@example.test',password:'test-password',role:'developer'};
beforeEach(()=>{state.tables=[];state.inserts=[];state.existing=[];state.request=vi.fn(async()=>new Response(JSON.stringify({success:true,userId:'auth-a',passwordUnchanged:false}),{status:200}));});
describe('staff sign-in recovery',()=>{
 it('only reports success after server confirms complete binding',async()=>{
  expect((await createStaffMember(input)).error).toBeNull();expect(state.tables).not.toContain('memberships');
 });
 it('preserves a saved profile after uncertain provider response',async()=>{
  state.request.mockRejectedValue(new Error('Network interrupted'));
  const result=await createStaffMember(input);expect(result.code).toBe('failed');expect(state.inserts).toHaveLength(1);
 });
 it('retries the existing profile instead of creating another seat',async()=>{
  state.existing=[{id:'saved-profile',email:input.email,name:input.name}];state.request.mockResolvedValue(new Response(JSON.stringify({success:true,userId:'auth-a',passwordUnchanged:true}),{status:200}));
  const result=await createStaffMember(input);expect(result.error).toBeNull();expect(result.passwordUnchanged).toBe(true);expect(state.inserts).toHaveLength(0);
  expect(JSON.parse(state.request.mock.calls[0][1].body).appUserId).toBe('saved-profile');
 });
 it('does not claim success for an unverified response',async()=>{
  state.request.mockResolvedValue(new Response('{}',{status:200}));expect((await createStaffMember(input)).code).toBe('failed');
 });
 it('explains that an already-completed account password was not changed',async()=>{
  state.existing=[{id:'saved-profile',email:input.email}];state.request.mockResolvedValue(new Response(JSON.stringify({success:true,userId:'auth-a',alreadyExists:true}),{status:200}));
  const result=await createStaffMember(input);expect(result.code).toBe('duplicate');expect(result.error).toMatch(/password was not changed/);
 });
});
