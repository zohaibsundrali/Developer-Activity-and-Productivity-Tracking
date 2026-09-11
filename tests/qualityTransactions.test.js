import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rpc: vi.fn(), blocked: null }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => ({
 rpc: state.rpc, from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'project' } }) }; return q; },
}) }));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.blocked }));
import { POST } from '../src/app/api/quality/route';
const project = '10000000-0000-0000-0000-000000000001';
const execution = '10000000-0000-0000-0000-000000000002';
const call = (action, body) => POST(new Request(`http://localhost/api/quality?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
beforeEach(() => { state.auth = { orgId: 'org', appUserId: 'actor', userType: 'developer', role: 'qa', overrides: {} }; state.blocked = null; state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: { success: true }, error: null }); });
describe('atomic QA creation routes', () => {
 it('creates a run through one transaction using verified identity and no caller case scope', async () => {
  state.rpc.mockResolvedValue({ data: { success: true, run: { id: 'run' }, cases: 3 } });
  const res = await call('run', { projectId: project, name: ' Release ', notes: ' Notes ', caseIds: ['omit-failing-case'], actor: 'forged' });
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ success: true, run: { id: 'run' }, cases: 3 });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith('create_quality_run', { p_org: 'org', p_actor: 'actor', p_type: 'developer', p_project: project, p_name: 'Release', p_notes: 'Notes' });
 });
 it('raises a defect atomically with bounded text and existing default severity', async () => {
  const res = await call('bug', { executionId: execution, severity: 'invalid', description: ' x ', environment: ' web ' });
  expect(res.status).toBe(200);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith('raise_quality_bug', { p_org: 'org', p_actor: 'actor', p_type: 'developer', p_execution: execution, p_description: 'x', p_severity: 'major', p_environment: 'web' });
 });
 it.each([['42501', 'QA_FORBIDDEN: denied', 403], ['P0002', 'QA_NOT_FOUND: Missing', 404], ['22023', 'QA_INVALID: Invalid scope', 400], ['P0001', 'QA_CONFLICT: Already linked', 409], ['P0001', 'PLAN_LIMIT_REACHED: tasks', 402], ['P0001', 'BILLING_LOCKED: expired', 402], ['XX000', 'secret database detail', 503]])('maps transaction refusal %s %s', async (code, message, status) => {
  state.rpc.mockResolvedValue({ error: { code, message } });
  const res = await call('bug', { executionId: execution });
  expect(res.status).toBe(status); expect((await res.json()).error).not.toContain('secret database detail');
 });
 it('rejects an explicit denied capability before calling the service transaction', async () => {
  state.auth.overrides = { 'bug.raise': false };
  expect((await call('bug', { executionId: execution })).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
 });
 it('rejects a client even if its role claims owner', async () => {
  state.auth.userType = 'client'; state.auth.role = 'owner';
  expect((await call('bug', { executionId: execution })).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
 });
 it('rejects invalid IDs and empty run names before RPC', async () => {
  expect((await call('bug', { executionId: 'invalid' })).status).toBe(400);
  expect((await call('run', { projectId: project, name: ' ' })).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
 });
});
