import { describe, it, expect } from 'vitest';
import { monitoringDateWindow, createMonitoringEventGuard } from '@/utils/monitoringViewGuard';
describe('monitoring calendar windows', () => {
  it.each([['today','2026-09-12'],['week','2026-09-06'],['month','2026-08-14']])('uses complete UTC %s window', (range, from) => {
    expect(monitoringDateWindow('2026-09-12', range)).toEqual({ start: `${from}T00:00:00.000Z`, end: '2026-09-13T00:00:00.000Z' });
  });
  it.each(['', null, undefined, '2026-02-30', '2026-13-01', '0000-01-01', '9999-12-31', '2026-09-12T10:00Z'])('rejects invalid day %s', day => expect(monitoringDateWindow(day,'today')).toBeNull());
  it('does not invent a window for unsupported ranges or date underflow', () => {
    expect(monitoringDateWindow('2026-09-12','year')).toBeNull();
    expect(monitoringDateWindow('0001-01-01','week')).toBeNull();
  });
  it('preserves early years and leap dates without Date.UTC century conversion', () => {
    expect(monitoringDateWindow('0099-02-28','today')?.start).toBe('0099-02-28T00:00:00.000Z');
    expect(monitoringDateWindow('2024-02-29','today')?.end).toBe('2024-03-01T00:00:00.000Z');
  });
});
function fixture(patch={}) {
  const live = { org: 'org', identity: 'admin:one', scope: 'developer:day', allowed: true };
  const guard = createMonitoringEventGuard({ organizationId:'org', identity:'admin:one', scope:'developer:day',
    getOrganizationId:()=>live.org,getIdentity:()=>live.identity,getScope:()=>live.scope,canMonitor:()=>live.allowed,...patch });
  return { live, guard };
}
describe('monitoring callback scope', () => {
  it('accepts the current organization event', () => expect(fixture().guard.accepts({ organization_id:'org' })).toBe(true));
  it.each([['org','other'],['identity','admin:two'],['scope','another-day'],['allowed',false]])('rejects a stale %s', (key,value) => {
    const { live, guard }=fixture();live[key]=value;expect(guard.current()).toBe(false);expect(guard.accepts({organization_id:'org'})).toBe(false);
  });
  it('rejects queued events after cleanup even when the same selection returns', () => {
    const { guard }=fixture();guard.dispose();expect(guard.current()).toBe(false);expect(guard.accepts({organization_id:'org'})).toBe(false);
  });
  it('rechecks a deferred update after authority changes', () => {
    const { guard,live }=fixture();expect(guard.current()).toBe(true);const update=()=>guard.accepts({organization_id:'org'});live.identity='developer:two';expect(update()).toBe(false);
  });
  it.each([null,{}, {organization_id:'other'}])('rejects missing or foreign row scope %j',row=>expect(fixture().guard.accepts(row)).toBe(false));
  it.each([{identity:null},{organizationId:null}])('requires resolved identity %j',patch=>expect(fixture(patch).guard.current()).toBe(false));
});
