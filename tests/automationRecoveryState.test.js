import { describe, expect, it, vi } from 'vitest';
import { createAutomationRecovery } from '@/utils/automationRecoveryState';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(fetchJobs = vi.fn().mockResolvedValue({ data: [] }), process = vi.fn().mockResolvedValue({})) {
  let ctx = { organizationId: 'org', userId: 'actor', userType: 'developer' };
  const publish = vi.fn();
  const recovery = createAutomationRecovery({ getContext: () => ctx, fetchJobs, process, publish });
  return { ...recovery, publish, process, switchIdentity: patch => { ctx = { ...ctx, ...patch }; }, last: () => publish.mock.lastCall[0] };
}
describe('own automation recovery', () => {
 it('distinguishes loading, success empty, and failed loading with a working refresh', async () => {
  const read = vi.fn().mockResolvedValueOnce({ error: new Error('offline') }).mockResolvedValueOnce({ data: [] });
  const s = setup(read); const pending = s.load(); expect(s.last().loading).toBe(true);
  await pending; expect(s.last()).toMatchObject({ loaded: false, loading: false }); expect(s.last().error).toContain('Could not load');
  await s.load(); expect(s.last()).toMatchObject({ loaded: true, error: '', jobs: [] });
 });
 it.each([{ organizationId: 'other' }, { userId: 'other' }, { userType: 'admin' }])('discards history after identity switch %j', async patch => {
  const d = deferred(); const s = setup(() => d.promise); const pending = s.load();
  s.switchIdentity(patch); d.resolve({ data: [{ id: 'private' }] }); await pending;
  expect(s.last().jobs).toEqual([]); expect(s.last().error).toContain('account changed');
 });
 it('ignores late responses after unmount and superseded loads', async () => {
  const a = deferred(); const b = deferred(); const read = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const s = setup(read); const old = s.load(); const recent = s.load();
  b.resolve({ data: [{ id: 'new' }] }); await recent; a.resolve({ data: [{ id: 'old' }] }); await old;
  expect(s.last().jobs).toEqual([{ id: 'new' }]);
  const c = deferred(); const unmount = setup(() => c.promise); const pending = unmount.load(); unmount.dispose();
  const count = unmount.publish.mock.calls.length; c.resolve({ data: [{ id: 'hidden' }] }); await pending;
  expect(unmount.publish).toHaveBeenCalledTimes(count);
 });
 it('serializes manual retry and reports failures without unhandled rejection', async () => {
  const d = deferred(); const s = setup(undefined, vi.fn(() => d.promise));
  const pending = s.retry(); await s.retry(); expect(s.process).toHaveBeenCalledTimes(1);
  d.resolve({ errors: [{ message: 'Permission revoked' }] }); await pending;
  expect(s.last()).toMatchObject({ busy: false, error: 'Permission revoked' });
  const failed = setup(undefined, vi.fn().mockRejectedValue(new Error('offline'))); await failed.retry();
  expect(failed.last().error).toContain('Could not retry'); expect(failed.last().busy).toBe(false);
 });
 it('does not reload or display an old retry result after profile change', async () => {
  const d = deferred(); const read = vi.fn(); const s = setup(read, () => d.promise);
  const pending = s.retry(); s.switchIdentity({ userId: 'different' }); d.resolve({ errors: [{ message: 'old secret' }] }); await pending;
  expect(read).not.toHaveBeenCalled(); expect(s.last().error).not.toContain('old secret'); expect(s.last().jobs).toEqual([]);
 });
});
