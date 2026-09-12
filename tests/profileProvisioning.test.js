import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(()=>({}));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>state.auth,serviceClient:()=>state.svc}));
vi.mock('@/utils/serverPermissions',()=>({authCan:()=>state.allowed}));
vi.mock('@/utils/entitlements',()=>({checkSeatLimitForRole:async()=>null}));
vi.mock('@/utils/systemEvents',()=>({recordEvent:async()=>{}}));
import {POST,GET} from '@/app/api/auth/provision/route';
const input={email:'staff@example.test',password:'secret-test-value',role:'developer',userType:'developer',appUserId:'profile-a'};
const request=(body=input)=>new Request('https://app.test/api/auth/provision',{method:'POST',body:JSON.stringify(body)});
const identity=()=>({id:'reserved-auth',email:input.email,app_metadata:{organization_id:'org-a',app_user_id:'profile-a',user_type:'developer',role:'developer',provisioning_id:'reservation-a'}});
beforeEach(()=>{
 state.auth={orgId:'org-a',role:'owner',userType:'admin'};state.allowed=true;state.reservation={authUserId:'reserved-auth',reservationId:'reservation-a',alreadyLinked:false};state.finish={data:true};
 state.svc={from:table=>{const q={select:()=>q,eq:()=>q,ilike:async()=>({data:[]}),maybeSingle:async()=>({data:{id:'profile-a',organization_id:'org-a',email:input.email}})};return q;},
 rpc:vi.fn(async name=>name==='reserve_profile_provision'?{data:state.reservation}:name==='profile_provision_status'?{data:[]}:state.finish),
 auth:{admin:{getUserById:vi.fn(async()=>({error:{status:404}})),createUser:vi.fn(async()=>({data:{user:identity()}})),deleteUser:vi.fn()}}};
});
describe('reserved profile provisioning',()=>{
 it('persists a checked Auth link and membership before success',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({success:true,userId:'reserved-auth',passwordUnchanged:false});
  expect(state.svc.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({id:'reserved-auth',app_metadata:identity().app_metadata}));
  expect(state.svc.rpc).toHaveBeenCalledWith('finish_profile_provision',expect.objectContaining({p_org:'org-a',p_profile:'profile-a',p_auth:'reserved-auth'}));
 });
 it('recovers only its exact reserved account without resetting its password',async()=>{
  state.svc.auth.admin.getUserById.mockResolvedValue({data:{user:identity()}});
  const response=await POST(request());expect(response.status).toBe(200);expect((await response.json()).passwordUnchanged).toBe(true);expect(state.svc.auth.admin.createUser).not.toHaveBeenCalled();
 });
 it('recovers a lost create response by reserved ID',async()=>{
  state.svc.auth.admin.createUser.mockResolvedValue({error:{status:500}});
  state.svc.auth.admin.getUserById.mockResolvedValueOnce({error:{status:404}}).mockResolvedValueOnce({data:{user:identity()}});
  expect((await POST(request())).status).toBe(200);expect(state.svc.auth.admin.getUserById.mock.calls).toEqual([['reserved-auth'],['reserved-auth']]);
 });
 it('retains an uncertain creation for same-profile retry without deletion',async()=>{
  state.svc.auth.admin.createUser.mockResolvedValue({error:{status:422,message:'Email already registered'}});
  const response=await POST(request());expect(response.status).toBe(503);expect((await response.json()).retryable).toBe(true);expect(state.svc.auth.admin.deleteUser).not.toHaveBeenCalled();
  expect(state.svc.rpc.mock.calls.some(([name])=>name==='finish_profile_provision')).toBe(false);
 });
 it.each(['organization_id','app_user_id','user_type','role','provisioning_id'])('rejects a mismatched reserved %s',async key=>{
  const user=identity();user.app_metadata[key]='other';state.svc.auth.admin.getUserById.mockResolvedValue({data:{user}});
  expect((await POST(request())).status).toBe(409);expect(state.svc.auth.admin.createUser).not.toHaveBeenCalled();expect(state.svc.auth.admin.deleteUser).not.toHaveBeenCalled();
 });
 it('reports pending when checked finalization fails',async()=>{
  state.finish={error:{code:'unavailable'}};const response=await POST(request());expect(response.status).toBe(503);expect((await response.json()).retryable).toBe(true);
 });
 it('does not create a replacement for a broken existing link',async()=>{
  state.reservation.alreadyLinked=true;expect((await POST(request())).status).toBe(409);expect(state.svc.auth.admin.createUser).not.toHaveBeenCalled();
 });
 it('refuses an empty successful Auth lookup rather than creating an account',async()=>{
  state.svc.auth.admin.getUserById.mockResolvedValue({data:{user:null}});
  expect((await POST(request())).status).toBe(503);expect(state.svc.auth.admin.createUser).not.toHaveBeenCalled();
 });
 it('refuses malformed inputs before creating identities' ,async()=>{
  expect((await POST(request({...input,appUserId:null}))).status).toBe(400);expect(state.svc.auth.admin.createUser).not.toHaveBeenCalled();
 });
 it('scopes recovery status to the verified organization',async()=>{
  expect((await GET(new Request('https://app.test/api/auth/provision?orgId=foreign'))).status).toBe(200);
  expect(state.svc.rpc).toHaveBeenCalledWith('profile_provision_status',{p_org:'org-a'});
  state.allowed=false;expect((await GET(new Request('https://app.test/api/auth/provision'))).status).toBe(403);
 });
});
