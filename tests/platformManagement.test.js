import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn(),email:vi.fn()}));
vi.mock('@/utils/workspaceIdentity',()=>({workspaceIdentity:mocks.identity,isUuid:v=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v)}));
vi.mock('@/utils/emailService',()=>({sendTemplatedEmail:mocks.email}));
const api=await import('@/app/api/platform/management/route');
const accessApi=await import('@/app/api/platform/access/route');
const UID='11111111-1111-4111-8111-111111111111',SID='22222222-2222-4222-8222-222222222222';
const cap={role:'support',permissions:['members.manage','organizations.manage','organizations.read'],mfaRequired:false,mfaSatisfied:false};
const request=body=>new Request('http://localhost/api/platform/management',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({svc:{rpc:mocks.rpc},user:{id:UID,email:'support@example.test'},sessionId:SID});mocks.rpc.mockImplementation(name=>Promise.resolve({data:name==='platform_access'?cap:{success:true}}));});
describe('platform management authority',()=>{
 it('rejects anonymous mutation',async()=>{mocks.identity.mockResolvedValue(null);expect((await api.POST(request({action:'member.sessions',membershipId:UID,reason:'Security incident'}))).status).toBe(401);});
 it('rejects delegated role management before SQL mutation',async()=>{expect((await api.POST(request({action:'team.upsert',email:'owner@example.test',role:'owner',reason:'Escalation attempt'}))).status).toBe(403);expect(mocks.rpc.mock.calls.some(c=>c[0]==='platform_management_mutate')).toBe(false);});
 it('requires current session MFA even when permission exists',async()=>{mocks.rpc.mockResolvedValue({data:{...cap,mfaRequired:true,mfaSatisfied:false}});const res=await api.POST(request({action:'member.sessions',membershipId:UID,reason:'Security incident'}));expect(res.status).toBe(403);expect((await res.json()).code).toBe('MFA_REQUIRED');});
 it('rejects an old aal1 token even after its live session reached aal2',async()=>{mocks.rpc.mockResolvedValue({data:{...cap,mfaRequired:true,mfaSatisfied:true}});const res=await api.POST(request({action:'member.sessions',membershipId:UID,reason:'Security incident'}));expect(res.status).toBe(403);expect((await res.json()).code).toBe('MFA_REQUIRED');});
 it('exposes only access metadata for MFA enrollment gate',async()=>{mocks.rpc.mockResolvedValue({data:{...cap,mfaRequired:true,mfaSatisfied:false}});const res=await accessApi.GET(new Request('http://localhost/api/platform/access'));expect(res.status).toBe(403);expect(await res.json()).toMatchObject({platformAccess:true,role:'support',code:'MFA_REQUIRED'});});
 it('uses verified identity and strips injected authority',async()=>{await api.POST(request({action:'member.sessions',membershipId:UID,reason:'Security incident',p_auth:'forged',auth:'forged'}));expect(mocks.rpc).toHaveBeenLastCalledWith('platform_management_mutate',{p_auth:UID,p_session:SID,p_action:'member.sessions',p_data:{membershipId:UID},p_reason:'Security incident'});});
 it('does not mutate if durable access audit fails',async()=>{mocks.rpc.mockImplementation(name=>Promise.resolve(name==='platform_access'?{data:cap}:{error:{code:'50000'}}));expect((await api.POST(request({action:'member.sessions',membershipId:UID,reason:'Security incident'}))).status).toBe(503);expect(mocks.rpc.mock.calls.some(c=>c[0]==='platform_management_mutate')).toBe(false);});
});
