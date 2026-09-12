import {describe,it,expect,vi} from 'vitest';
import {recoverProfileProvisions} from '@/utils/profileProvisioningRecovery';
const job={id:'reservation',organization_id:'org',profile_id:'person',user_type:'developer',role:'hr',email:'person@test.dev',auth_user_id:'auth'};
const user={id:'auth',email:job.email,app_metadata:{provisioning_id:'reservation',organization_id:'org',app_user_id:'person',user_type:'developer',role:'hr'}};
const service=()=>({rpc:vi.fn(async name=>name==='claim_profile_provisions'?{data:[job]}:{data:true}),auth:{admin:{getUserById:vi.fn(async()=>({data:{user}}))}}});
describe('background profile provisioning completion',()=>{
 it('only finalizes the exact reserved Auth account',async()=>{const svc=service();expect(await recoverProfileProvisions(svc)).toEqual({checked:1,completed:1,pending:0,errors:[]});expect(svc.auth.admin.getUserById).toHaveBeenCalledWith('auth');expect(svc.rpc).toHaveBeenCalledWith('finish_profile_provision',expect.objectContaining({p_auth:'auth',p_profile:'person'}));});
 it('leaves absent Auth for original same-profile retry without creating anything',async()=>{const svc=service();svc.auth.admin.getUserById.mockResolvedValue({error:{status:404}});expect((await recoverProfileProvisions(svc)).pending).toBe(1);expect(svc.rpc).toHaveBeenCalledOnce();});
 it('refuses stale or foreign reservation metadata',async()=>{const svc=service();svc.auth.admin.getUserById.mockResolvedValue({data:{user:{...user,app_metadata:{...user.app_metadata,provisioning_id:'foreign'}}}});expect((await recoverProfileProvisions(svc)).errors).toHaveLength(1);expect(svc.rpc).toHaveBeenCalledOnce();});
 it('reports failed finalization and leaves its recorded attempt retryable',async()=>{const svc=service();svc.rpc.mockResolvedValueOnce({data:[job]}).mockResolvedValueOnce({error:{code:'failed'}});expect((await recoverProfileProvisions(svc)).errors).toHaveLength(1);});
 it('fails clearly when claim state is unavailable',async()=>{const svc=service();svc.rpc.mockResolvedValue({error:{code:'unavailable'}});await expect(recoverProfileProvisions(svc)).rejects.toThrow('unavailable');});
});
