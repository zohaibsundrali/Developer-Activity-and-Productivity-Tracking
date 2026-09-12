import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitoringAppRefresh } from '../src/utils/monitoringAppRefresh';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(refresh = vi.fn(async () => {})) {
  const state = { current: true };
  const guard = { current: () => state.current, accepts: row => state.current && row?.organization_id === 'org' };
  return { state, refresh, handler: createMonitoringAppRefresh({ guard, refresh }), row: { organization_id: 'org' } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('serialized application realtime refresh', () => {
  it('coalesces an insert/update burst into one authoritative request', async () => {
    const { handler, refresh, row } = fixture();
    handler.notify(row); handler.notify(row); handler.notify(row);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('serializes one followup for all events arriving during an in-flight read', async () => {
    const first = deferred();
    const refresh = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const { handler, row } = fixture(refresh);
    handler.notify(row);
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    handler.notify(row); handler.notify(row);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('rejects foreign rows and a permission change before timer execution', async () => {
    const { handler, state, refresh, row } = fixture();
    handler.notify({ organization_id: 'other' });
    await vi.runAllTimersAsync(); expect(refresh).not.toHaveBeenCalled();
    handler.notify(row); state.current = false;
    await vi.runAllTimersAsync(); expect(refresh).not.toHaveBeenCalled();
  });
  it('cancels pending timers on disposal', async () => {
    const { handler, refresh, row } = fixture();
    handler.notify(row); handler.dispose(); handler.notify(row);
    await vi.runAllTimersAsync(); expect(refresh).not.toHaveBeenCalled();
  });
  it('does not schedule followups after disposal during a request', async () => {
    const first = deferred(); const refresh = vi.fn(() => first.promise);
    const { handler, row } = fixture(refresh);
    handler.notify(row); vi.advanceTimersByTime(200);
    handler.notify(row); handler.dispose(); first.resolve();
    await vi.runAllTimersAsync(); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('contains rejected refreshes and still handles a queued newer event', async () => {
    const first = deferred();
    const refresh = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const { handler, row } = fixture(refresh);
    handler.notify(row); vi.advanceTimersByTime(200); handler.notify(row);
    first.reject(new Error('offline'));
    await vi.runAllTimersAsync(); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('contains synchronous refresh exceptions', async () => {
    const refresh = vi.fn(() => { throw new Error('unavailable'); });
    const { handler, row } = fixture(refresh);
    handler.notify(row); await vi.runAllTimersAsync(); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('does not filter timestamps because updates can move a row out of range', async () => {
    const { handler, refresh, row } = fixture();
    handler.notify({ ...row, tracked_at: '1900-01-01T00:00:00Z' });
    await vi.runAllTimersAsync(); expect(refresh).toHaveBeenCalledTimes(1);
  });
});
