import { expect, it, vi } from 'vitest';
import { recoverSignups } from '@/utils/signupRecovery';
it('finalizes Auth-created reservations without credentials or Auth mutation', async () => {
 const svc = { rpc: vi.fn(async name => name === 'claim_signup_recovery' ? { data: [{ id: 'one', claim_id: 'lease' }, { id: 'two', claim_id: 'other' }] } : { data: { success: true } }) };
 expect(await recoverSignups(svc)).toEqual({ completed: 2, errors: [] });
 expect(svc.rpc).toHaveBeenCalledWith('finish_signup', { p_id: 'one', p_claim: 'lease' });
});
it('preserves failed reservations while processing independent successful ones', async () => {
 const svc = { rpc: vi.fn(async (name,args) => name === 'claim_signup_recovery' ? { data: [{ id: 'one', claim_id: 'lease' }, { id: 'two', claim_id: 'other' }] } : args.p_id === 'one' ? { error: { message: 'sensitive internal error' } } : { data: { success: true } }) };
 expect(await recoverSignups(svc)).toEqual({ completed: 1, errors: [{ signupId: 'one', message: 'Signup finalization unavailable' }] });
});
