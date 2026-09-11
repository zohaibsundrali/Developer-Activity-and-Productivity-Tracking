import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rpc: vi.fn(), flush: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => ({ rpc: state.rpc }) }));
vi.mock('@/utils/proposalDecisionEmails', () => ({ flushProposalDecisionEmails: (...args) => state.flush(...args) }));
import { POST } from '../src/app/api/proposals/[id]/decide/route';
const id = '10000000-0000-4000-8000-000000000001';
const call = (body = { decision: 'accepted' }, proposal = id) => POST(new Request('http://localhost/api/proposals/x/decide', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: proposal }) });
beforeEach(() => {
  state.auth = { orgId: 'verified-org', appUserId: id, userType: 'admin', role: 'owner', overrides: {} };
  state.rpc.mockReset().mockResolvedValue({ data: { proposal: { id, status: 'accepted' }, project: { id: 'existing' } }, error: null });
  state.flush.mockReset().mockResolvedValue({ delivered: 1, pending: 0 });
});
it('sends only verified organization and typed actor to a single transaction', async () => {
  expect((await call({ decision: 'accepted', organization_id: 'spoof', actor: 'spoof', managerId: id, managerType: 'developer' })).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledWith('decide_project_proposal', expect.objectContaining({ p_org: 'verified-org', p_actor: id, p_actor_type: 'admin', p_manager: id, p_manager_type: 'developer' }));
});
it.each([[null, 401], [{ userType: 'client', role: 'owner', overrides: {} }, 403], [{ userType: 'admin', role: 'owner', overrides: { 'proposal.decide': false } }, 403]])('blocks unauthorized callers', async (auth, status) => {
  state.auth = auth; expect((await call()).status).toBe(status); expect(state.rpc).not.toHaveBeenCalled();
});
it.each(['project.create', 'project.assign_manager'])('composes %s before accepting', async permission => {
  state.auth.overrides[permission] = false;
  expect((await call({ decision: 'accepted', managerId: id })).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
});
it.each([true, [], {}, 'bad', -1, Infinity])('rejects invalid estimate %j', async value => {
  expect((await call({ decision: 'estimate', estimatedCost: value })).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
});
it('preserves zero estimate and rounded duration without external costing notification', async () => {
  expect((await call({ decision: 'estimate', estimatedCost: 0, estimatedTimelineDays: 2.4, internalNotes: 'private' })).status).toBe(200);
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_cost: 0, p_days: 2, p_internal_notes: 'private' }); expect(state.flush).not.toHaveBeenCalled();
});
it.each([['42501', '', 403], ['P0002', '', 404], ['22023', '', 400], ['P0001', 'PROPOSAL_CONFLICT private', 409], ['P0001', 'BILLING_LOCKED private', 402], ['XX000', 'secret database', 503]])('maps transaction errors safely', async (code, message, status) => {
  state.rpc.mockResolvedValue({ error: { code, message } }); const res = await call(); expect(res.status).toBe(status); expect(JSON.stringify(await res.json())).not.toContain(message || 'private'); expect(state.flush).not.toHaveBeenCalled();
});
it('reports retained delivery failure without undoing committed acceptance', async () => {
  state.flush.mockRejectedValue(new Error('provider secret')); const res = await call(); expect(res.status).toBe(200); expect((await res.json()).notificationWarning).toContain('queued for retry'); expect(state.rpc).toHaveBeenCalledTimes(1);
});
it('returns recovered accepted project without constructing a replacement', async () => {
  state.rpc.mockResolvedValue({ data: { proposal: { id, status: 'accepted' }, project: { id: 'original' }, replayed: true } });
  const res = await call(); expect((await res.json()).project.id).toBe('original'); expect(state.rpc).toHaveBeenCalledTimes(1);
});
it('rejects malformed IDs and missing public decline reason before privileged calls', async () => {
  expect((await call(undefined, 'injected')).status).toBe(400);
  expect((await call({ decision: 'rejected', reason: ' ' })).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
});
