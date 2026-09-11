import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ overrides: {}, overrideError:false }));
vi.mock('@/utils/permissionOverrides', () => ({ loadOverrides: async (_svc, subject) => {
 if(state.overrideError) throw new Error('lookup unavailable'); return state.overrides[subject.appUserId] || {};
} }));
import { notifyTaskPlanReviewers } from '@/utils/taskPlanNotifications';
const project={id:'project',name:'Private project',created_by:'owner',added_by:'owner',assigned_to:'developer',task_plan_submitted_at:'2026-09-11T10:00:00Z'};
let rows, members, keys, failure;
function client() { return { rpc: async () => ({ data: true }), from(table) {
 if(table==='notifications') return { insert: row => ({select: async()=> {
  if(failure) return {error:{code:'503'}};
  if(keys.has(row.dedupe_key)) return {error:{code:'23505'}};
  keys.add(row.dedupe_key); rows.push(row); return {data:[{id:'notice'}]};
 }})};
 const filters=[]; const b={select:()=>b,eq:(key,value)=>(filters.push(m=>m[key]===value),b),in:(key,values)=>(filters.push(m=>values.includes(m[key])),b),then: resolve=>resolve({data:members.filter(m=>filters.every(f=>f(m)))})}; return b;
 }}; }
beforeEach(()=>{rows=[];keys=new Set();failure=false;state.overrides={};state.overrideError=false;members=[{organization_id:'org',user_id:'owner',user_type:'admin',role:'owner',status:'active',email:'owner@example.test'},{organization_id:'org',user_id:'developer',user_type:'developer',role:'developer',status:'active'}];});
it('notifies the actual project owner once, never assigned_to',async()=>{
 await notifyTaskPlanReviewers(client(),'org',project);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({admin_id:'owner',admin_recipient_type:'admin',project_id:'project'});
 expect(rows[0].developer_id).toBeUndefined();
});
it('retries deduplicate the same submitted revision but notify a later revision',async()=>{
 await notifyTaskPlanReviewers(client(),'org',project);await notifyTaskPlanReviewers(client(),'org',project);
 expect(rows).toHaveLength(1);
 await notifyTaskPlanReviewers(client(),'org',{...project,task_plan_submitted_at:'2026-09-12T10:00:00Z'});
 expect(rows).toHaveLength(2);
});
it('does not guess colliding untyped project owner IDs',async()=>{
 members.push({...members[0],user_type:'developer',role:'manager'});
 await notifyTaskPlanReviewers(client(),'org',project);expect(rows).toHaveLength(0);
});
it('honors explicit review denial',async()=>{
 state.overrides.owner={'task.review':false};await notifyTaskPlanReviewers(client(),'org',project);expect(rows).toHaveLength(0);
});
it('fails closed if individual permissions cannot be loaded',async()=>{
 state.overrideError=true;await expect(notifyTaskPlanReviewers(client(),'org',project)).rejects.toThrow();expect(rows).toHaveLength(0);
});
it('resolves the existing legacy email ownership path',async()=>{
 await notifyTaskPlanReviewers(client(),'org',{...project,created_by:null,added_by:null,added_by_admin:'OWNER@example.test'});
 expect(rows).toHaveLength(1);
});
it('excludes inactive or foreign-organization owners',async()=>{
 members[0].status='suspended';members.push({...members[0],organization_id:'other',status:'active'});
 await notifyTaskPlanReviewers(client(),'org',project);expect(rows).toHaveLength(0);
});
it('reports delivery failures so the saved plan can retry its notice',async()=>{
 failure=true;await expect(notifyTaskPlanReviewers(client(),'org',project)).rejects.toThrow('could not be delivered');
});

it('does not notify the plan submitter to review their own work',async()=>{
 members[0].user_type='developer';
 const result=await notifyTaskPlanReviewers(client(),'org',{...project,assigned_developer_id:'owner'});
 expect(rows).toHaveLength(0);expect(result.warning).toContain('no unambiguous');
});

it('typed admin owners are not confused with a colliding developer submitter',async()=>{
 members.push({...members[0],user_type:'developer'});
 await notifyTaskPlanReviewers(client(),'org',{...project,created_by_type:'admin',added_by_type:'admin',assigned_developer_id:'owner'});
 expect(rows).toHaveLength(1);expect(rows[0].admin_recipient_type).toBe('admin');
});
it('a suspended colliding profile still makes historical ownership ambiguous',async()=>{
 members.push({...members[0],user_type:'developer',status:'suspended'});
 await notifyTaskPlanReviewers(client(),'org',project);expect(rows).toHaveLength(0);
});
it('the shared ownership predicate can refuse a candidate despite review permission',async()=>{
 const svc=client();svc.rpc=async()=>({data:false});await notifyTaskPlanReviewers(svc,'org',project);expect(rows).toHaveLength(0);
});

it('notifies a delegated manager with effective review permission',async()=>{
 members.push({organization_id:'org',user_id:'manager',user_type:'developer',role:'manager',status:'active'});
 await notifyTaskPlanReviewers(client(),'org',{...project,created_by:null,added_by:null,manager_id:'manager',manager_type:'developer'});
 expect(rows).toHaveLength(1);expect(rows[0].developer_id).toBe('manager');
});
it('does not notify a delegated manager with an explicit review denial',async()=>{
 members.push({organization_id:'org',user_id:'manager',user_type:'developer',role:'manager',status:'active'});
 state.overrides.manager={'task.review':false};
 await notifyTaskPlanReviewers(client(),'org',{...project,created_by:null,added_by:null,manager_id:'manager',manager_type:'developer'});
 expect(rows).toHaveLength(0);
});
it('does not notify the assigned developer as their own delegated reviewer',async()=>{
 members[1].role='manager';
 await notifyTaskPlanReviewers(client(),'org',{...project,created_by:null,added_by:null,manager_id:'developer',manager_type:'developer',assigned_developer_id:'developer'});
 expect(rows).toHaveLength(0);
});
