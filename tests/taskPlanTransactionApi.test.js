import { beforeEach, expect, it, vi } from 'vitest';
const { state } = vi.hoisted(() => ({ state: {} }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => ({ rpc: async (name,args) => {
  state.calls.push({name,args}); return state.result;
} }) }));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.gate }));
import { POST } from '@/app/api/task-plan/save-submit/route';
beforeEach(() => Object.assign(state, { auth: { orgId:'org', appUserId:'me', userType:'developer', role:'developer', overrides:{} }, calls:[], gate:null, result:{data:{success:true,tasks:[],project:{task_plan_status:'pending'}}} }));
async function send(body={projectId:'project',developerId:'forged',tasks:[{task_title:'Work'}]}) {
  const response=await POST(new Request('http://localhost/api/task-plan/save-submit',{method:'POST',body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json()};
}
it('uses verified identity for the atomic RPC',async()=>{
  expect((await send()).status).toBe(200);
  expect(state.calls[0]).toMatchObject({name:'save_and_submit_task_plan',args:{p_org:'org',p_developer:'me',p_project:'project'}});
});
it.each(['admin','client'])('rejects a %s profile before RPC',async userType=>{
  state.auth.userType=userType; expect((await send()).status).toBe(403); expect(state.calls).toHaveLength(0);
});
it('honors explicit denial',async()=>{ state.auth.overrides={'task.update_own':false}; expect((await send()).status).toBe(403); expect(state.calls).toHaveLength(0); });
it('honors locked subscriptions',async()=>{state.gate={status:402,error:'Locked'};expect((await send()).status).toBe(402);expect(state.calls).toHaveLength(0);});
it.each([[{code:'P0001',message:'PLAN_LIMIT_REACHED: full'},402],[{code:'P0001',message:'PLAN_CONFLICT: approved'},409],[{code:'22007',message:'bad date'},400],[{code:'PGRST202',message:'private database details'},503]])('maps database failure %j',async(error,status)=>{state.result={error};const result=await send();expect(result.status).toBe(status);expect(JSON.stringify(result.body)).not.toContain('private database details');});
it.each([null,{}, {projectId:'project',tasks:[]}])('rejects incomplete body %j',async body=>{expect((await send(body)).status).toBe(400);expect(state.calls).toHaveLength(0);});
