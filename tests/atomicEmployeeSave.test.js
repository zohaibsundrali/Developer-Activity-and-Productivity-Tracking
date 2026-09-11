import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),authFetch:vi.fn()}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/utils/orgFiles',()=>({uploadOrgFile:vi.fn()}));
vi.mock('@/utils/orgContext',()=>({getOrgId:()=> 'org'}));
vi.mock('@/utils/authFetch',()=>({authFetch:mocks.authFetch}));
import { saveEmployee,setEmployeeStatus } from '@/utils/employeesData';
const emp={membershipId:'member',userId:'person',userType:'developer',role:'developer'};
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:{success:true,membershipId:'member',userId:'person',userType:'developer'}});});
it('sends both patches to one scoped typed transaction',async()=>{
 expect(await saveEmployee({orgId:'org',emp,membershipPatch:{role:'developer',team_id:'team'},profilePatch:{designation:'Engineer'}})).toEqual({error:null});
 expect(mocks.rpc).toHaveBeenCalledWith('save_employee_record',{p_org:'org',p_membership:'member',p_user:'person',p_type:'developer',p_membership_patch:{team_id:'team'},p_profile_patch:{designation:'Engineer'}});
 expect(mocks.authFetch).not.toHaveBeenCalled();
});
it('returns database rollback errors and does not claim success on an unconfirmed identity',async()=>{
 mocks.rpc.mockResolvedValueOnce({error:{message:'permission denied'}});
 expect((await setEmployeeStatus(emp,'suspended')).error.message).toBe('permission denied');
 mocks.rpc.mockResolvedValueOnce({data:{success:true,userType:'admin'}});
 expect((await setEmployeeStatus(emp,'active')).error.message).toContain('not confirmed');
});
it('reports the separate Auth role boundary truthfully',async()=>{
 mocks.authFetch.mockResolvedValue({ok:true,json:async()=>({success:true})});mocks.rpc.mockResolvedValue({error:{message:'Field denied'}});
 expect((await saveEmployee({orgId:'org',emp,membershipPatch:{role:'manager',status:'active'}})).error.message).toContain('The role was changed');
});
it('refuses invalid profile before role or database writes',async()=>{
 expect((await saveEmployee({orgId:'org',emp:{...emp,userType:'client'},membershipPatch:{role:'manager'}})).error).toBeTruthy();
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.authFetch).not.toHaveBeenCalled();
});
