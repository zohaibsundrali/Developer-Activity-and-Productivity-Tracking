import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeWorkspaceSession } from '@/utils/workspaceSessionObserver';
const ctx = { organization_id: 'org-a', app_user_id: 'profile-a', user_type: 'admin', role: 'owner' };
const token = metadata => `header.${Buffer.from(JSON.stringify({ app_metadata: metadata })).toString('base64url')}.signature`;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(current = ctx) {
  let listener, metadata = ctx;
  const change = vi.fn(), unsubscribe = vi.fn();
  const stop = observeWorkspaceSession({
    onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe } } }; },
    getSession: async () => ({ data: { session: { access_token: token(metadata) } } }),
  }, () => current, change);
  return { change, unsubscribe, stop, emit: async (event, next, broadcastOnly = false) => {
    if (!broadcastOnly) metadata = next;
    listener(event, { access_token: token(next) }); await vi.runAllTimersAsync();
  } };
}
it('keeps a refreshed token with the same typed workspace', async () => {
  const s = setup(); await s.emit('TOKEN_REFRESHED', ctx); expect(s.change).not.toHaveBeenCalled();
});
it.each(['organization_id', 'app_user_id', 'user_type', 'role'])('discards stale UI when %s changes in a duplicated session', async key => {
  const s = setup(); await s.emit('TOKEN_REFRESHED', { ...ctx, [key]: 'changed' }); await s.emit('TOKEN_REFRESHED', ctx);
  expect(s.change).toHaveBeenCalledTimes(1);
});
it('does not interfere with an explicit switch that already cleared its context', async () => {
  const s = setup(null); await s.emit('TOKEN_REFRESHED', ctx); expect(s.change).not.toHaveBeenCalled();
});
it('ignores another independent tab broadcasting its different workspace', async () => {
  const s = setup(); await s.emit('SIGNED_IN', { ...ctx, organization_id: 'other' }, true); expect(s.change).not.toHaveBeenCalled();
});
it('cleans up its subscription', async () => {
  const s = setup(); s.stop(); await s.emit('TOKEN_REFRESHED', {}); expect(s.unsubscribe).toHaveBeenCalledOnce(); expect(s.change).not.toHaveBeenCalled();
});
