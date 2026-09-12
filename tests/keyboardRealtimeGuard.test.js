import { describe, it, expect } from 'vitest';
import { createKeyboardRealtimeGuard } from '../src/utils/keyboardRealtimeGuard';
function setup() {
  const live = { org: 'org', identity: 'admin:one', scope: 'dev:day', allowed: true };
  const guard = createKeyboardRealtimeGuard({ organizationId: 'org', identity: 'admin:one', scope: 'dev:day', developer: { id: 'dev', user_id: 'auth', email: 'dev@example.com' }, start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z', getOrganizationId: () => live.org, getIdentity: () => live.identity, getScope: () => live.scope, canMonitor: () => live.allowed });
  const row = { id: 'capture', organization_id: 'org', developer_id: 'dev', tracked_at: '2026-09-12T12:00:00Z' };
  return { live, guard, row };
}
describe('keyboard realtime queued event authority', () => {
  it('accepts a selected developer event in the frozen date range', () => {
    const { guard, row } = setup(); expect(guard.accepts(row)).toBe(true);
  });
  it.each([['scope','other:day'], ['identity','admin:two'], ['org','another'], ['allowed',false]])('rejects an old callback when %s changes', (key,value) => {
    const { live, guard, row } = setup(); live[key] = value; expect(guard.accepts(row)).toBe(false);
  });
  it('rejects queued callbacks after cleanup even when the same selection is reopened', () => {
    const { guard, row } = setup(); guard.dispose(); expect(guard.accepts(row)).toBe(false);
  });
  it('rechecks authority when a deferred state update is evaluated', () => {
    const { live, guard, row } = setup(); expect(guard.accepts(row)).toBe(true); live.allowed = false; expect(guard.accepts(row)).toBe(false);
  });
  it.each([{ organization_id: 'other' }, { developer_id: 'other', user_email: 'dev@example.com' }, { tracked_at: '2026-09-13T00:00:00Z' }, { tracked_at: null }, { id: null }])('rejects mismatched payload %j', patch => {
    const { guard, row } = setup(); expect(guard.accepts({ ...row, ...patch })).toBe(false);
  });
  it('allows legacy email attribution only without a contradictory explicit profile', () => {
    const { guard, row } = setup(); expect(guard.accepts({ ...row, developer_id: null, user_email: 'dev@example.com' })).toBe(true);
  });
});
