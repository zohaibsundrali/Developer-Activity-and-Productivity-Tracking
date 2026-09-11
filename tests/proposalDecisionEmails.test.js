import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/utils/mailer', () => ({ sendMail: (...args) => state.send(...args), notifyEmailHtml: ({ body }) => `HTML:${body}` }));
import { flushProposalDecisionEmails } from '../src/utils/proposalDecisionEmails';
const job = { id: 'job', lease_id: 'lease', proposal_id: 'proposal', organization_id: 'org', client_id: 'client', title: 'Public title', reason: 'Public reason', decision: 'accepted' };
function client(options = {}) {
  const rows = { clients: { id: 'client', organization_id: 'org', status: 'active', email: 'current@example.test' }, memberships: { user_id: 'client', user_type: 'client', organization_id: 'org', status: 'active' }, ...options.rows };
  return { rpc: vi.fn(async (name, args) => name === 'claim_proposal_decision_emails' ? { data: [job], error: options.claimError } : { data: options.ack === undefined ? true : options.ack, error: null }),
    from: table => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[table], error: options.readError }) }; return q; } };
}
beforeEach(() => state.send.mockReset().mockResolvedValue({ delivered: true }));
it('delivers only public copy to the current active typed client and acknowledges matching lease', async () => {
  const svc = client(); expect(await flushProposalDecisionEmails(svc, 'proposal')).toEqual({ delivered: 1, pending: 0 });
  expect(state.send.mock.calls[0][0]).toMatchObject({ to: 'current@example.test', organizationId: 'org', template: 'proposal_decision' });
  expect(svc.rpc).toHaveBeenLastCalledWith('finish_proposal_decision_email', { p_id: 'job', p_lease: 'lease', p_delivered: true });
});
it.each([{ delivered: false, ok: true, mode: 'mock' }, { delivered: false, error: 'unavailable' }])('retains mock/failed delivery for retry', async result => {
  state.send.mockResolvedValue(result); const svc = client(); expect((await flushProposalDecisionEmails(svc)).pending).toBe(1);
  expect(svc.rpc.mock.calls[1][1].p_delivered).toBe(false);
});
it.each([{ memberships: null }, { memberships: { user_id: 'client', user_type: 'developer', organization_id: 'org', status: 'active' } }, { clients: { id: 'client', email: 'other@example.test', organization_id: 'other', status: 'active' } }, { clients: { id: 'client', email: 'inactive@example.test', organization_id: 'org', status: 'inactive' } }])('withholds removed/colliding/inactive/cross-org recipients', async rows => {
  expect((await flushProposalDecisionEmails(client({ rows }))).pending).toBe(1); expect(state.send).not.toHaveBeenCalled();
});
it('fails closed on recipient query errors and exposes acknowledgement failure', async () => {
  expect((await flushProposalDecisionEmails(client({ readError: {} }))).pending).toBe(1); expect(state.send).not.toHaveBeenCalled();
  await expect(flushProposalDecisionEmails(client({ ack: false }))).rejects.toThrow('acknowledgement');
});
it('does not deliver without claiming the durable queue', async () => {
  await expect(flushProposalDecisionEmails(client({ claimError: {} }))).rejects.toThrow('queue'); expect(state.send).not.toHaveBeenCalled();
});
