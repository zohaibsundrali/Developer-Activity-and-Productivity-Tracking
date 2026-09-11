import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({stripe:null}));
vi.mock('@/utils/stripeServer',()=>({stripeClient:()=>state.stripe}));
import { processOrganizationDeletion } from '../src/utils/organizationDeletion';
const baseJob={id:'job',lease:'lease',organization_id:'org',auth_user_id:'owner-auth',stage:'storage'};
function service({job=baseJob,items=[],check='present',valid=true,removeError=null,finalError=null}={}) {
 let current=[...items];let removed=false;let authGone=false;
 const svc={rpc:vi.fn(async(name,args)=>{
  if(name==='claim_organization_deletion')return{data:job};
  if(name==='organization_deletion_items')return{data:current};
  if(name==='check_deletion_storage_item')return{data:removed?'absent':check};
  if(name==='check_deletion_auth_identity')return{data:valid};
  if(name==='finish_organization_deletion_step'){if(args.p_item)current=current.filter(x=>x.id!==args.p_item);return{data:true};}
  if(name==='finalize_organization_deletion')return{data:!finalError,error:finalError};
  throw new Error('Unexpected RPC');
 }),storage:{from:vi.fn(()=>({remove:vi.fn(async()=>{if(!removeError)removed=true;return{error:removeError};})}))},
 auth:{admin:{getUserById:vi.fn(async id=>authGone?{error:{status:404}}:{data:{user:{id,app_metadata:{organization_id:'org',app_user_id:'profile',user_type:'developer'}}}}),deleteUser:vi.fn(async()=>{authGone=true;return{};})}},
 from:()=>{const q={select:()=>q,eq:()=>q,neq:()=>q,limit:async()=>({data:[]})};return q;}};
 return svc;
}
beforeEach(()=>{state.stripe=null;});
it('deletes only the captured exact object through Storage API then verifies absence',async()=>{
 const svc=service({items:[{id:'item',bucket:'screenshots',path:'org/file'}]});
 expect(await processOrganizationDeletion(svc,{maxSteps:1})).toMatchObject({processed:true});
 expect(svc.storage.from).toHaveBeenCalledWith('screenshots');
 expect(svc.rpc.mock.calls.filter(([name])=>name==='check_deletion_storage_item')).toHaveLength(2);
 expect(svc.rpc).toHaveBeenCalledWith('finish_organization_deletion_step',expect.objectContaining({p_item:'item'}));
});
it('retains failed objects without advancing to Auth and records retry',async()=>{
 const svc=service({items:[{id:'item',bucket:'screenshots',path:'org/file'}],removeError:{}});
 expect((await processOrganizationDeletion(svc,{maxSteps:1})).retry).toBe(true);
 expect(svc.rpc).toHaveBeenLastCalledWith('finish_organization_deletion_step',expect.objectContaining({p_error:true}));
 expect(svc.auth.admin.deleteUser).not.toHaveBeenCalled();
});
it('does not delete a changed or unverified object',async()=>{
 const svc=service({items:[{id:'item',bucket:'screenshots',path:'org/file'}],check:'changed'});
 expect((await processOrganizationDeletion(svc,{maxSteps:1})).retry).toBe(true);expect(svc.storage.from).not.toHaveBeenCalled();
});
it('retries an already absent object without repeating Storage deletion',async()=>{
 const svc=service({items:[{id:'item',bucket:'screenshots',path:'org/file'}],check:'absent'});
 expect((await processOrganizationDeletion(svc,{maxSteps:1})).retry).toBeUndefined();expect(svc.storage.from).not.toHaveBeenCalled();
});
it('deletes only a currently verified typed exclusive Auth identity and confirms 404',async()=>{
 const svc=service({job:{...baseJob,stage:'auth'},items:[{id:'item',resource_id:'auth',profile_id:'profile',profile_type:'developer'}]});
 await processOrganizationDeletion(svc,{maxSteps:1});expect(svc.auth.admin.deleteUser).toHaveBeenCalledWith('auth');
 expect(svc.rpc).toHaveBeenCalledWith('check_deletion_auth_identity',expect.objectContaining({p_item:'item'}));
});
it.each([false,true])('preserves shared or mismatched Auth identity (shared=%s)',async shared=>{
 const svc=service({job:{...baseJob,stage:'auth'},items:[{id:'item',resource_id:'auth',profile_id:shared?'profile':'foreign',profile_type:'developer'}],valid:!shared});
 await processOrganizationDeletion(svc,{maxSteps:1});expect(svc.auth.admin.deleteUser).not.toHaveBeenCalled();
 expect(svc.rpc).toHaveBeenCalledWith('finish_organization_deletion_step',expect.objectContaining({p_retained:true}));
});
it('does not erase database state when billing provider is unavailable',async()=>{
 const svc=service({job:{...baseJob,stage:'billing',stripe_customer_id:'cus'}});
 expect((await processOrganizationDeletion(svc,{maxSteps:1})).retry).toBe(true);expect(svc.storage.from).not.toHaveBeenCalled();
});
it('cancels verified subscriptions immediately without proration or refund',async()=>{
 const sub={id:'sub',customer:'cus',metadata:{organization_id:'org'},status:'active'};
 state.stripe={checkout:{sessions:{list:vi.fn(async()=>({data:[],has_more:false})),expire:vi.fn()}},customers:{retrieve:vi.fn(async()=>({metadata:{organization_id:'org'}}))},subscriptions:{list:vi.fn(async()=>({data:[sub],has_more:false})),cancel:vi.fn(async()=>({status:'canceled'}))}};
 const svc=service({job:{...baseJob,stage:'billing',stripe_customer_id:'cus',stripe_subscription_id:'sub'}});
 expect((await processOrganizationDeletion(svc,{maxSteps:1})).retry).toBeUndefined();
 expect(state.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub',{invoice_now:false,prorate:false});
});
it('refuses cancellation when tenant metadata belongs to another organization',async()=>{
 state.stripe={customers:{retrieve:vi.fn(async()=>({metadata:{organization_id:'foreign'}}))},subscriptions:{cancel:vi.fn()}};
 const svc=service({job:{...baseJob,stage:'billing',stripe_customer_id:'cus'}});
 expect((await processOrganizationDeletion(svc,{maxSteps:1})).retry).toBe(true);expect(state.stripe.subscriptions.cancel).not.toHaveBeenCalled();
});
it('retains durable job for database failure and supports no-job polling',async()=>{
 expect((await processOrganizationDeletion(service({job:{...baseJob,stage:'database'},finalError:{}}))).retry).toBe(true);
 expect(await processOrganizationDeletion(service({job:null}))).toMatchObject({processed:false,steps:0});
});
