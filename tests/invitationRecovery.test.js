import { describe, it, expect, vi } from "vitest";
import { recoverInvitations } from "@/utils/invitationRecovery";
function fixture({ lookupError = null, mismatch = false, deleteError = null, finishError = null } = {}) {
  const attempt = { invitation_id: 'invite', organization_id: 'org', profile_id: 'profile', auth_user_id: 'auth', claim_id: 'claim' };
  const svc = {
    rpc: vi.fn(async name => name === 'claim_invitation_cleanup' ? { data: [attempt] } : { error: finishError }),
    auth: { admin: {
      getUserById: vi.fn(async () => ({ data: lookupError ? null : { user: { app_metadata: { invitation_id: mismatch ? 'other' : 'invite', organization_id: 'org', app_user_id: 'profile' } } }, error: lookupError })),
      deleteUser: vi.fn(async () => ({ error: deleteError })),
    } },
  };
  return svc;
}
describe('leased invitation recovery', () => {
  it('cleans only the reserved identity and confirms the matching lease', async () => {
    const svc = fixture();
    expect(await recoverInvitations(svc)).toEqual({ cleaned: 1, errors: [] });
    expect(svc.auth.admin.deleteUser).toHaveBeenCalledWith('auth');
    expect(svc.rpc).toHaveBeenLastCalledWith('finish_invitation_cleanup', { p_id: 'invite', p_claim: 'claim' });
  });
  it.each([{ status: 404 }, { code: 'user_not_found' }])('recovers an already removed account', async lookupError => {
    const svc = fixture({ lookupError });
    expect((await recoverInvitations(svc)).cleaned).toBe(1);
    expect(svc.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it.each([{ lookupError: { status: 503 } }, { mismatch: true }])('never deletes on uncertain or mismatched identity %j', async options => {
    const svc = fixture(options);
    const result = await recoverInvitations(svc);
    expect(result.cleaned).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(svc.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(svc.rpc).toHaveBeenCalledTimes(1);
  });
  it('retains the attempt when Auth deletion fails', async () => {
    const svc = fixture({ deleteError: { message: 'unavailable' } });
    expect((await recoverInvitations(svc)).cleaned).toBe(0);
    expect(svc.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not count an unconfirmed cleanup as complete', async () => {
    const svc = fixture({ finishError: { message: 'timeout' } });
    expect((await recoverInvitations(svc)).cleaned).toBe(0);
  });
});
