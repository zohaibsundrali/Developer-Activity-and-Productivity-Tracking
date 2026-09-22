import {describe,it,expect,vi} from 'vitest';
import {validateBillingAction,executeBillingAction} from '@/utils/platformBilling';
const org='11111111-1111-4111-8111-111111111111',req='22222222-2222-4222-8222-222222222222';
const base={organizationId:org,requestId:req,reason:'Requested by account owner',action:'cancel_subscription'};
const context={billingOrganizationId:org,subscription:{stripe_customer_id:'cus_1',stripe_subscription_id:'sub_1'},plans:[{code:'pro',stripe_price_id:'price_pro'}],invoice:{organization_id:org,stripe_invoice_id:'in_1'}};
const client=()=>({subscriptions:{retrieve:vi.fn().mockResolvedValue({id:'sub_1',customer:'cus_1',status:'trialing',trial_end:1800000000,items:{data:[{id:'si_1',quantity:2}]}}),update:vi.fn().mockResolvedValue({id:'sub_1',status:'active'})},invoices:{retrieve:vi.fn().mockResolvedValue({customer:'cus_1',subscription:'sub_1',status:'paid',amount_paid:1000,payment_intent:'pi_1'})},refunds:{create:vi.fn().mockResolvedValue({id:'re_1',status:'succeeded',amount:500,currency:'usd',created:1800000000})}});
describe('platform billing validation',()=>{
 it('requires explicit reason and immutable request ID',()=>{expect(()=>validateBillingAction({...base,reason:'x'})).toThrow();expect(()=>validateBillingAction({...base,requestId:'anything'})).toThrow();});
 it('does not coerce refund amounts or accept negative/fractional values',()=>{for(const amountCents of ['100',-1,0,1.2])expect(()=>validateBillingAction({...base,action:'refund',invoiceId:org,amountCents})).toThrow();});
 it('rejects trials outside one year',()=>expect(()=>validateBillingAction({...base,action:'extend_trial',trialEnd:'2040-01-01'},1800000000000)).toThrow());
});
describe('Stripe scope and retries',()=>{
 it('rejects customer mismatch before any mutation',async()=>{const s=client();s.subscriptions.retrieve.mockResolvedValue({customer:'cus_other'});await expect(executeBillingAction(s,context,base)).rejects.toThrow('customer');expect(s.subscriptions.update).not.toHaveBeenCalled();});
 it('schedules cancellation and reuses stable provider idempotency',async()=>{const s=client();await executeBillingAction(s,context,base);expect(s.subscriptions.update).toHaveBeenCalledWith('sub_1',{cancel_at_period_end:true},{idempotencyKey:`platform-billing-${req}`});});
 it('keeps quantity and uses configured price only',async()=>{const s=client();await executeBillingAction(s,context,{...base,action:'change_plan',planCode:'pro'});expect(s.subscriptions.update).toHaveBeenCalledWith('sub_1',expect.objectContaining({items:[{id:'si_1',price:'price_pro',quantity:2}],payment_behavior:'error_if_incomplete'}),expect.anything());});
 it('rejects invoice from another organization',async()=>{const s=client();await expect(executeBillingAction(s,{...context,invoice:{...context.invoice,organization_id:req}},{...base,action:'refund',amountCents:500})).rejects.toThrow('belong');expect(s.refunds.create).not.toHaveBeenCalled();});
 it('rejects provider invoice subscription mismatch',async()=>{const s=client();s.invoices.retrieve.mockResolvedValue({customer:'cus_1',subscription:'sub_other',status:'paid'});await expect(executeBillingAction(s,context,{...base,action:'refund',amountCents:500})).rejects.toThrow('subscription');});
 it('rejects refund beyond actual provider payment',async()=>{const s=client();await expect(executeBillingAction(s,context,{...base,action:'refund',amountCents:2000})).rejects.toThrow('exceeds');});
 it('refunds only scoped payment with request metadata',async()=>{const s=client();await executeBillingAction(s,context,{...base,action:'refund',amountCents:500});expect(s.refunds.create).toHaveBeenCalledWith(expect.objectContaining({payment_intent:'pi_1',amount:500}),{idempotencyKey:`platform-billing-${req}`});});
 it('cannot turn an active paid subscription into a trial',async()=>{const s=client();s.subscriptions.retrieve.mockResolvedValue({customer:'cus_1',status:'active'});await expect(executeBillingAction(s,context,{...base,action:'extend_trial',trialEnd:'2027-06-01'})).rejects.toThrow('existing trial');});
});
