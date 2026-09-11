import { beforeEach,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>state.auth,serviceClient:()=>({rpc:state.rpc})}));
import { POST } from '@/app/api/task-plan/review/route';
const call=(body={projectId:'project',action:'approve'})=>POST(new Request('http://localhost/api/task-plan/review',{method:'POST',body:JSON.stringify(body)}));
beforeEach(()=>{state.auth={orgId:'org',appUserId:'reviewer',userType:'admin',role:'owner',overrides:{}};state.rpc.mockReset();state.rpc.mockResolvedValue({data:{success:true,project:{id:'project',task_plan_status:'approved'},notifications:1}});});
it('commits one review with verified actor identity, ignoring legacy caller identity',async()=>{
 const response=await call({projectId:'project',action:'approve',adminId:'forged',adminEmail:'forged@example.test'});
 expect(response.status).toBe(200);expect(state.rpc).toHaveBeenCalledExactlyOnceWith('commit_task_plan_review',{
 p_org:'org',p_project:'project',p_reviewer:'reviewer',p_type:'admin',p_action:'approve',p_reason:null});
});
it('trims a rejection reason and returns the transaction outcome',async()=>{
 const response=await call({projectId:'project',action:'reject',rejectionReason:' revise scope '});
 expect(response.status).toBe(200);expect(state.rpc.mock.calls[0][1].p_reason).toBe('revise scope');
});
it.each([['42501','PLAN_REVIEW_FORBIDDEN: cannot review your own task plan',403],['P0002','PLAN_REVIEW_NOT_FOUND: project not found',404],['22P02','private details',400],['22023','private details',400],['P0001','PLAN_REVIEW_CONFLICT: no longer pending',409],['P0001','BILLING_LOCKED: subscription requires attention',402],['XX000','private database details',503]])('maps %s refusal safely',async(code,message,status)=>{
 state.rpc.mockResolvedValue({error:{code,message}});const response=await call();expect(response.status).toBe(status);
 expect((await response.json()).error).not.toContain('private');
});
it('refuses absent authentication and client profiles before database access',async()=>{
 state.auth=null;expect((await call()).status).toBe(401);state.auth={userType:'client'};expect((await call()).status).toBe(403);expect(state.rpc).not.toHaveBeenCalled();
});
it('honors effective permission denial even for an owner',async()=>{
 state.auth.overrides={'task.review':false};expect((await call()).status).toBe(403);expect(state.rpc).not.toHaveBeenCalled();
});
it.each([{projectId:'project',action:'reject',rejectionReason:''},{projectId:'project',action:'reject',rejectionReason:{}},{projectId:null,action:'approve'},{projectId:'project',action:'delete'}])('validates request before a mutation',async body=>{
 expect((await call(body)).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
});
it('does not claim success for an empty transaction response or thrown failure',async()=>{
 state.rpc.mockResolvedValue({data:null});expect((await call()).status).toBe(503);
 state.rpc.mockRejectedValue(new Error('secret'));const r=await call();expect(r.status).toBe(503);expect((await r.json()).error).not.toContain('secret');
});
