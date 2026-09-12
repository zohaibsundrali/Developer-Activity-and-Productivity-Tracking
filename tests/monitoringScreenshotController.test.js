import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMonitoringScreenshotController, attachScreenshotRenewal, validateScreenshotPage } from '../src/utils/monitoringScreenshotController';
const org = '11111111-1111-4111-8111-111111111111', profile = '22222222-2222-4222-8222-222222222222';
const id = n => `33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const row = n => ({ id: id(n), organization_id: org, developer_id: profile, captured_at: '2026-09-12T12:00:00Z', storage_path: `${org}/${profile}/${n}.jpg` });
const first = () => ({ rows: Array.from({ length: 24 }, (_, i) => row(30-i)), total: 30, next_cursor: { time: row(7).captured_at, id: id(7) } });
const last = () => ({ rows: Array.from({ length: 6 }, (_, i) => row(6-i)), total: 30, next_cursor: null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return { promise, resolve }; };
function fixture({ sign, pages = [first()] } = {}) {
  const current = { value: true };
  const client = { rpc: vi.fn(async () => ({ data: pages.shift(), error: null })) };
  const signer = sign || vi.fn(async rows => rows.map(r => ({ ...r, public_url: `signed:${r.id}` })));
  const onChange = vi.fn();
  const controller = createMonitoringScreenshotController({ client, organizationId: org, profileId: profile,
    start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z', sign: signer, onChange,
    makeGuard: () => ({ current: () => current.value, accepts: r => current.value && r.organization_id === org, dispose: () => { current.value=false; } }),
  });
  return { controller, client, sign: signer, current, onChange };
}
describe('scoped screenshot page controller', () => {
  it('signs only the visible metadata page and preserves the full total', async () => {
    const f=fixture(); await f.controller.refresh();
    expect(f.sign.mock.calls[0][0]).toHaveLength(24);
    expect(f.controller.getState()).toMatchObject({ total:30,page:1,hasNext:true,hasPrevious:false,loading:false });
    expect(f.client.rpc.mock.calls[0][1]).toMatchObject({ p_limit:24,p_cursor_time:null,p_cursor_id:null,p_organization_id:org,p_developer_id:profile });
  });
  it('navigates next/previous with exact keyset history', async () => {
    const f=fixture({pages:[first(),last(),first()]}); await f.controller.refresh(); await f.controller.next();
    expect(f.controller.getState()).toMatchObject({page:2,hasNext:false,hasPrevious:true,total:30});
    expect(f.client.rpc.mock.calls[1][1].p_cursor_id).toBe(id(7));
    await f.controller.previous(); expect(f.client.rpc.mock.calls[2][1].p_cursor_id).toBeNull();
    expect(f.controller.getState().page).toBe(1);
  });
  it('retains metadata and count when signing is denied', async () => {
    const f=fixture({sign:async () => {throw new Error('storage denied');}}); await f.controller.refresh();
    expect(f.controller.getState().rows).toHaveLength(24);
    expect(f.controller.getState().rows.every(r=>r.public_url===null)).toBe(true);
    expect(f.controller.getState().total).toBe(30);
  });
  it('keeps failed metadata totals unknown, not zero', async () => {
    const f=fixture({pages:[null]}); await f.controller.refresh();
    expect(f.controller.getState()).toMatchObject({rows:[],total:null,loading:false}); expect(f.controller.getState().error).toBeTruthy(); expect(f.sign).not.toHaveBeenCalled();
  });
  it.each([{organization_id:'foreign'},{developer_id:'foreign'},{captured_at:'2026-09-13T00:00:00Z'}])('rejects foreign/out-of-range metadata %j', patch => {
    const data=first();data.rows[0]={...data.rows[0],...patch};const f=fixture({pages:[data]});
    return f.controller.refresh().then(()=>{expect(f.controller.getState().error).toBeTruthy();expect(f.sign).not.toHaveBeenCalled();});
  });
  it('ignores a signing result after account/scope disposal', async () => {
    const signed=deferred(); const f=fixture({sign:()=>signed.promise}); const pending=f.controller.refresh();
    await Promise.resolve(); f.controller.dispose(); const calls=f.onChange.mock.calls.length;
    signed.resolve(first().rows.map(r=>({...r,public_url:'old'}))); await pending;
    expect(f.onChange).toHaveBeenCalledTimes(calls);
  });
  it('prevents a delayed renewal from overwriting a newer metadata page', async () => {
    const signed=deferred(); let n=0;
    const f=fixture({pages:[first(),last()],sign:async rows=>++n===2?signed.promise:rows.map(r=>({...r,public_url:`new:${r.id}`}))});
    await f.controller.refresh(); const renewing=f.controller.retryImages(); await f.controller.next();
    signed.resolve(first().rows.map(r=>({...r,public_url:'expired'}))); await renewing;
    expect(f.controller.getState().page).toBe(2);expect(f.controller.getState().rows[0].id).toBe(id(6));
  });
  it('renews visible URLs without reloading metadata or altering total', async () => {
    let n=0;const f=fixture({sign:async rows=>rows.map(r=>({...r,public_url:`url${++n}`}))});await f.controller.refresh(); const before=f.controller.getState().rows[0].public_url;
    await f.controller.retryImages();expect(f.controller.getState().rows[0].public_url).not.toBe(before);expect(f.controller.getState().total).toBe(30);expect(f.client.rpc).toHaveBeenCalledTimes(1);
  });
});
afterEach(()=>vi.useRealTimers());
it('renews after eight visible minutes or resumed focus and removes timers/listeners on cleanup', () => {
  vi.useFakeTimers(); const windowTarget=new EventTarget(),documentTarget=new EventTarget();documentTarget.visibilityState='visible';const renew=vi.fn();
  const stop=attachScreenshotRenewal({renew,windowTarget,documentTarget});vi.advanceTimersByTime(8*60*1000);expect(renew).toHaveBeenCalledTimes(1);
  documentTarget.visibilityState='hidden';vi.advanceTimersByTime(8*60*1000);expect(renew).toHaveBeenCalledTimes(1);
  documentTarget.visibilityState='visible';documentTarget.dispatchEvent(new Event('visibilitychange'));windowTarget.dispatchEvent(new Event('focus'));expect(renew).toHaveBeenCalledTimes(3);
  stop();vi.advanceTimersByTime(8*60*1000);windowTarget.dispatchEvent(new Event('focus'));expect(renew).toHaveBeenCalledTimes(3);
});

const bounds = { organizationId: org, profileId: profile, start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z', cursor: null };
it('preserves microsecond ordering even when UUID order differs within one millisecond', () => {
  const data = { rows: [{ ...row(1), captured_at: '2026-09-12T17:00:00.123999+05:00' }, { ...row(2), captured_at: '2026-09-12T12:00:00.123001Z' }], total: 2, next_cursor: null };
  expect(validateScreenshotPage(data, bounds)).toBe(data);
  expect(() => validateScreenshotPage({ ...data, rows: [...data.rows].reverse() }, bounds)).toThrow();
});
it('rejects a next cursor that differs from the last row only in microseconds', () => {
  const data = first();
  data.rows = data.rows.map(r => ({ ...r, captured_at: '2026-09-12T12:00:00.123456Z' }));
  data.next_cursor.time = '2026-09-12T12:00:00.123457Z';
  expect(() => validateScreenshotPage(data, bounds)).toThrow();
  data.next_cursor.time = '2026-09-12T17:00:00.123456+05:00';
  expect(validateScreenshotPage(data, bounds)).toBe(data);
});
it('accepts a subsequent cursor page within the same millisecond with higher UUIDs', () => {
  const data = { rows: [{ ...row(2), captured_at: '2026-09-12T12:00:00.123001Z' }], total: 25, next_cursor: null };
  expect(validateScreenshotPage(data, { ...bounds, cursor: { time: '2026-09-12T12:00:00.123999Z', id: id(1) } })).toBe(data);
});
