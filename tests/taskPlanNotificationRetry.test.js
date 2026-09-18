import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({}));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>state.auth, serviceClient:()=>({rpc:async()=>{state.rpc++;return {};},from:()=>{
 const b={select:()=>b,eq:(key,value)=>(state.filters.push([key,value]),b),maybeSingle:async()=>({data:state.project,error:null})};return b;
}})}));
vi.mock('@/utils/entitlements',()=>({requireUnlocked:async()=>null}));
vi.mock('@/utils/taskPlanNotifications',()=>({notifyTaskPlanReviewers:async()=>{state.notices++;return state.noticeResult;}}));
import {POST} from '@/app/api/task-plan/save-submit/route';
beforeEach(()=>Object.assign(state,{auth:{orgId:'org',appUserId:'developer',userType:'developer',role:'developer',overrides:{}},project:{id:'project',task_plan_status:'pending'},rpc:0,notices:0,filters:[],noticeResult:{notified:1}}));
const send=()=>POST(new Request('http://localhost/api/task-plan/save-submit',{method:'POST',body:JSON.stringify({projectId:'project',notificationOnly:true})}));
it('retries delivery without resaving any tasks',async()=>{
 expect((await send()).status).toBe(200);expect(state.rpc).toBe(0);expect(state.notices).toBe(1);
 expect(state.filters).toEqual(expect.arrayContaining([['organization_id','org'],['assigned_developer_id','developer'],['id','project']]));
});
it.each(['approved','rejected','draft'])('cannot replace a %s plan through notification retry',async status=>{
 state.project.task_plan_status=status;expect((await send()).status).toBe(409);expect(state.rpc).toBe(0);expect(state.notices).toBe(0);
});
it('refuses a missing or unassigned plan',async()=>{
 state.project=null;expect((await send()).status).toBe(404);expect(state.notices).toBe(0);
});
it('preserves recipient-resolution warnings for the retry UI',async()=>{
 state.noticeResult={warning:'No eligible reviewer'};expect(await(await send()).json()).toMatchObject({success:true,notificationWarning:'No eligible reviewer'});
});

it('shows plan confirmation names as text rather than HTML',()=>{
 const source=readFileSync(new URL('../src/app/developer/project-details/page.jsx',import.meta.url),'utf8');
 expect(source).toContain('showConfirm("Confirm Submission", confirmText');
 const viewport=readFileSync(new URL('../src/components/AlertsViewport.jsx',import.meta.url),'utf8');
 expect(viewport).toContain('{confirmation.text}');
 expect(viewport).not.toContain('dangerouslySetInnerHTML');
 expect(source).not.toContain('html: confirmHtml');
});
