import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => ({ role: 'owner' }) }));
import { allowed, loadPermissionSet, clearPermissionSet } from '@/utils/permissions';
const response = (permissions, extra = {}) => ({ ok: true, json: async () => ({ success: true, permissions, ...extra }) });
beforeEach(() => clearPermissionSet());
describe('permission loading does not preserve stale grants', () => {
  it('fails closed after a previous privileged session', async () => {
    await loadPermissionSet(async () => response(['billing.purchase']));
    expect(allowed('billing.purchase')).toBe(true);
    expect(await loadPermissionSet(async () => { throw new Error('offline'); })).toBe(false);
    expect(allowed('billing.purchase')).toBe(false);
  });
  it('rejects a successful HTTP response with unavailable overrides', async () => {
    expect(await loadPermissionSet(async () => response(['billing.purchase'], { overridesUnavailable: true }))).toBe(false);
    expect(allowed('billing.purchase')).toBe(false);
  });
  it('ignores a previous login response that arrives after the next login', async () => {
    let finish;
    const old = loadPermissionSet(() => new Promise(resolve => { finish = resolve; }));
    await loadPermissionSet(async () => response(['task.view_own']));
    finish(response(['billing.purchase']));
    expect(await old).toBe(false);
    expect(allowed('billing.purchase')).toBe(false);
    expect(allowed('task.view_own')).toBe(true);
  });
});
