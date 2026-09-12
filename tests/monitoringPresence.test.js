import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMonitoringPresenceController, monitoringPresenceView, validateMonitoringPresence } from '../src/utils/monitoringPresence';
const org = '11111111-1111-4111-8111-111111111111', profile = '22222222-2222-4222-8222-222222222222';
const device = { id: '33333333-3333-4333-8333-333333333333', name: 'Desktop', platform: 'Windows', state: 'tracking', last_seen_at: '2026-09-12T12:00:00Z', expires_at: '2026-10-12T12:00:00Z', revoked_at: null };
const receipt = () => ({ organization_id: org, developer_id: profile, server_now: '2026-09-12T12:00:00Z', freshness_seconds: 90, devices: [{ ...device }], total: 1, truncated: false });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
afterEach(() => vi.useRealTimers());
function setup(rpc = async () => ({ data: receipt() })) {
  let clock = 0, permitted = true;
  const onChange = vi.fn(), client = { rpc: vi.fn(rpc) };
  const controller = createMonitoringPresenceController({ client, organizationId: org, profileId: profile, onChange,
    guard: { current: () => permitted }, now: () => clock });
  return { controller, client, onChange, advance: ms => { clock += ms; }, revoke: () => { permitted = false; } };
}
describe('live monitoring presence', () => {
  it('ages server receipts at the exact freshness boundary without the browser wall clock', () => {
    const r = receipt();
    expect(monitoringPresenceView(r, 89999).status).toBe('tracking');
    expect(monitoringPresenceView(r, 90000).status).toBe('disconnected');
    expect(monitoringPresenceView(r, -1).status).toBe('unknown');
  });
  it('distinguishes no heartbeat, expiry and revocation from a connected stopped timer', () => {
    for (const [patch, expected] of [[{ state: null, last_seen_at: null }, 'unavailable'], [{ state: 'idle' }, 'idle'], [{ revoked_at: device.last_seen_at }, 'revoked'], [{ expires_at: device.last_seen_at }, 'expired']]) {
      const r = receipt(); Object.assign(r.devices[0], patch);
      expect(monitoringPresenceView(r).devices[0].status).toBe(expected);
    }
  });
  it('prioritizes fresh tracking across devices and discloses an incomplete device cohort', () => {
    const r = receipt(); r.devices.push({ ...device, id: profile, state: 'paused' }); r.total = 2;
    expect(monitoringPresenceView(r).status).toBe('tracking');
    r.devices[0].revoked_at = device.last_seen_at;
    expect(monitoringPresenceView(r).status).toBe('paused');
    r.devices = []; r.truncated = true;
    expect(monitoringPresenceView(r).status).toBe('unknown');
  });
  it.each([{ organization_id: profile }, { developer_id: org }, { server_now: 'invalid' }, { freshness_seconds: 999 }, { total: 0 }, { truncated: true }])('rejects malformed or foreign receipts %j', patch => {
    expect(() => validateMonitoringPresence({ ...receipt(), ...patch }, org, profile)).toThrow();
  });
  it('rejects duplicate, future-dated and inconsistent device receipts', () => {
    const r = receipt(); r.devices.push({ ...device }); r.total = 2;
    expect(() => validateMonitoringPresence(r, org, profile)).toThrow();
    r.devices.pop(); r.total = 1; r.devices[0].last_seen_at = '2026-09-13T00:00:00Z';
    expect(() => validateMonitoringPresence(r, org, profile)).toThrow();
    r.devices[0].last_seen_at = null;
    expect(() => validateMonitoringPresence(r, org, profile)).toThrow();
  });
  it('scopes the RPC and includes network delay conservatively when aging', async () => {
    const pending = deferred(), f = setup(() => pending.promise);
    const work = f.controller.refresh(); f.advance(90000); pending.resolve({ data: receipt() }); await work;
    expect(f.client.rpc).toHaveBeenCalledWith('monitoring_tracker_presence', { p_organization_id: org, p_developer_id: profile });
    expect(f.onChange.mock.lastCall[0].status).toBe('disconnected');
  });
  it('serializes polls and discards responses after scope disposal or permission loss', async () => {
    for (const lose of ['dispose', 'revoke']) {
      const pending = deferred(), f = setup(() => pending.promise);
      const work = f.controller.refresh(); await f.controller.refresh();
      expect(f.client.rpc).toHaveBeenCalledTimes(1);
      if (lose === 'dispose') f.controller.dispose(); else f.revoke();
      pending.resolve({ data: receipt() }); await work; f.controller.tick();
      expect(f.onChange).not.toHaveBeenCalled();
    }
  });
  it('clears online status on a failed read and retains its error across age ticks', async () => {
    let fail = false; const f = setup(async () => fail ? { error: new Error('denied') } : { data: receipt() });
    await f.controller.refresh(); expect(f.onChange.mock.lastCall[0].status).toBe('tracking');
    fail = true; await f.controller.refresh(); f.advance(1000); f.controller.tick();
    expect(f.onChange.mock.lastCall[0]).toMatchObject({ status: 'unknown', devices: [], error: expect.any(String) });
    expect(f.onChange.mock.lastCall[0].error).toBeTruthy();
  });
  it('times out a hung poll, permits retry and ignores the old late response', async () => {
    vi.useFakeTimers(); const pending = deferred(); let first = true;
    const f = setup(() => { if (first) { first = false; return pending.promise; } return Promise.resolve({ data: receipt() }); });
    const work = f.controller.refresh(); await vi.advanceTimersByTimeAsync(15000); await work;
    expect(f.onChange.mock.lastCall[0].status).toBe('unknown');
    await f.controller.refresh(); expect(f.onChange.mock.lastCall[0].status).toBe('tracking');
    const count = f.onChange.mock.calls.length;
    pending.resolve({ error: new Error('old') }); await Promise.resolve();
    expect(f.onChange).toHaveBeenCalledTimes(count);
  });
  it('invalidates pre-sleep receipts and fences a late request before fetching fresh status', async () => {
    const pending = deferred(); let call = 0;
    const f = setup(() => ++call === 2 ? pending.promise : Promise.resolve({ data: receipt() }));
    await f.controller.refresh(); const old = f.controller.refresh();
    f.controller.invalidate(); f.controller.tick();
    expect(f.onChange.mock.lastCall[0]).toMatchObject({ status: 'unknown', devices: [], loading: true });
    await f.controller.refresh();
    const count = f.onChange.mock.calls.length;
    pending.resolve({ error: new Error('pre-sleep') }); await old;
    expect(f.onChange).toHaveBeenCalledTimes(count);
    expect(f.onChange.mock.lastCall[0].status).toBe('tracking');
  });
});
