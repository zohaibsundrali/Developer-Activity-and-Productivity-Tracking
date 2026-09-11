import { beforeEach,it,expect,vi } from 'vitest';
const s=vi.hoisted(()=>({auth:null,denied:null,rpc:vi.fn(),caller:vi.fn()}));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>s.auth,orgScopedClient:s.caller}));
vi.mock('@/utils/serverPermissions',()=>({requirePermission:()=>s.denied}));
import { GET,PATCH } from '@/app/api/organizations/retention/route';
beforeEach(()=>{s.auth={orgId:'verified-org',userType:'admin',role:'owner',token:'actor-jwt'};s.denied=null;s.rpc.mockReset().mockResolvedValue({data:{mode:'custom',days:30}});s.caller.mockReset().mockReturnValue({rpc:s.rpc});});
const request=body=>new Request('https://example.test/api/organizations/retention',{method:'PATCH',body:JSON.stringify(body)});
it('uses verified organization and actor RLS, not submitted organization',async()=>{const r=await PATCH(request({organizationId:'victim',mode:'custom',days:30,confirmPermanentDeletion:true}));expect(r.status).toBe(200);expect(s.caller).toHaveBeenCalledWith('actor-jwt');expect(s.rpc).toHaveBeenCalledWith('set_tracking_retention',{p_org:'verified-org',p_mode:'custom',p_days:30,p_confirm:true});});
it('requires explicit permanent deletion confirmation',async()=>{expect((await PATCH(request({mode:'plan'}))).status).toBe(400);expect(s.rpc).not.toHaveBeenCalled();});
it.each([0,-1,1.5,null])('rejects invalid configured days %s',async days=>{expect((await PATCH(request({mode:'custom',days,confirmPermanentDeletion:true}))).status).toBe(400);expect(s.rpc).not.toHaveBeenCalled();});
it('refuses non-owner and permission override denials',async()=>{s.auth.role='admin';expect((await GET(new Request('https://example.test'))).status).toBe(403);s.auth.role='owner';s.denied=new Response('{}',{status:403});expect((await GET(new Request('https://example.test'))).status).toBe(403);expect(s.rpc).not.toHaveBeenCalled();});
it('reports schema/network failures rather than inventing disabled state',async()=>{s.rpc.mockResolvedValue({error:{code:'42P01'}});expect((await GET(new Request('https://example.test'))).status).toBe(503);});

it('allows an owner stored in developer profiles without treating type as role',async()=>{s.auth.userType='developer';expect((await GET(new Request('https://example.test'))).status).toBe(200);});
