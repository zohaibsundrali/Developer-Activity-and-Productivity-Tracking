import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth,serviceClient: () => ({ from(table) {
 const q = { select: () => q,eq: () => q,order: () => q,maybeSingle: async () => ({data:{id:'project'}}),then: resolve => Promise.resolve({data:table==='project_members'?[{user_id:'person',user_type:'developer',project_role:'developer',allocation_pct:20}]:[]}).then(resolve) };return q;
} }) }));
vi.mock('@/utils/projectAccess', async original => ({ ...await original(), withProjectRoles: async auth => auth }));
import { GET } from '../src/app/api/projects/[id]/members/route';
const call = () => GET(new Request('http://localhost/api/projects/project/members'),{params:{id:'project'}});
beforeEach(() => {state.auth={orgId:'org',appUserId:'actor',userType:'developer',role:'employee',projectRoles:{project:'developer'},overrides:{}};});
it('grants allocation controls independently from membership management', async () => {
 state.auth.overrides['capacity.allocate']=true; const res=await call();expect(res.status).toBe(200);expect(await res.json()).toMatchObject({canAllocate:true,canManage:false});
});
it('keeps allocation denied even when membership management is allowed', async () => {
 state.auth.role='owner';state.auth.overrides['capacity.allocate']=false;expect(await (await call()).json()).toMatchObject({canAllocate:false,canManage:true});
});
it('does not bypass roster visibility with allocation permission', async () => {
 state.auth.projectRoles={};state.auth.overrides['capacity.allocate']=true;expect((await call()).status).toBe(404);
});
