import { afterEach, describe, expect, it, vi } from 'vitest';
import { localShiftCandidates, localShiftValue, resolveLocalShiftTime, validateShiftInput } from '@/utils/workShifts';
import { createWorkShiftPager } from '@/utils/workShiftPager';

const input = { id: 'b1000000-0000-0000-0000-000000000001', version: 0, userId: '99100000-0000-0000-0000-000000000011', userType: 'developer', start: '2026-10-12T09:00:00Z', end: '2026-10-12T17:00:00Z', timezone: 'Europe/Berlin', title: ' Day shift ', status: 'draft' };
describe('shift wall clocks and input', () => {
  it('converts Karachi local time to an explicit UTC instant', () => {
    expect(resolveLocalShiftTime('2026-10-12T09:00', 'Asia/Karachi')).toBe('2026-10-12T04:00:00.000Z');
    expect(localShiftValue('2026-10-12T04:00:00Z', 'Asia/Karachi')).toBe('2026-10-12T09:00');
  });
  it('rejects a nonexistent spring-forward hour', () => {
    expect(localShiftCandidates('2026-03-29T02:30', 'Europe/Berlin')).toEqual([]);
    expect(() => resolveLocalShiftTime('2026-03-29T02:30', 'Europe/Berlin')).toThrow('does not exist');
  });
  it('requires an explicit choice for the repeated autumn hour', () => {
    const candidates = localShiftCandidates('2026-10-25T02:30', 'Europe/Berlin');
    expect(candidates).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
    expect(() => resolveLocalShiftTime('2026-10-25T02:30', 'Europe/Berlin')).toThrow('twice');
    expect(resolveLocalShiftTime('2026-10-25T02:30', 'Europe/Berlin', 'earlier')).toBe(candidates[0]);
    expect(resolveLocalShiftTime('2026-10-25T02:30', 'Europe/Berlin', 'later')).toBe(candidates[1]);
  });
  it('supports quarter-hour offsets and overnight shifts', () => {
    expect(resolveLocalShiftTime('2026-10-12T09:00', 'Asia/Kathmandu')).toBe('2026-10-12T03:15:00.000Z');
    expect(validateShiftInput({ ...input, start: '2026-10-12T22:00:00+05:00', end: '2026-10-13T06:00:00+05:00' })).toMatchObject({ start: '2026-10-12T17:00:00.000Z', end: '2026-10-13T01:00:00.000Z', title: 'Day shift', note: '' });
  });
  it.each([{ id: [input.id] }, { userId: [input.userId] }, { userType: 'client' }, { version: '0' }, { version: -1 }, { status: 'deleted' }, { timezone: 'Not/AZone' }, { start: '2026-02-30T09:00:00Z' }, { start: '2026-10-12T09:00:00' }, { start: '2026-10-12T09:00:01Z' }, { end: input.start }, { end: '2026-10-15T09:00:00Z' }, { title: ' ' }, { note: 'x'.repeat(1001) }])('rejects malformed scheduling input %j', patch => {
    expect(() => validateShiftInput({ ...input, ...patch })).toThrow();
  });
});

describe('schedule pages', () => {
  afterEach(() => vi.useRealTimers());
  const receipt = (id, nextCursor = null) => ({ shifts: [{ id }], nextCursor, canManage: false, canViewAll: false });
  it('rejects repeated cursors and duplicate rows instead of hiding page drift', async () => {
    const states = [], read = vi.fn().mockResolvedValueOnce(receipt('one', 'next')).mockResolvedValueOnce(receipt('one'));
    const pager = createWorkShiftPager(read, s => states.push(s)); await pager.load(); await pager.load(true);
    expect(states.at(-1).error).toContain('changed between pages');
    expect(states.at(-1).shifts).toEqual([{ id: 'one' }]); pager.dispose();
  });
  it('clears prior account data and discards a late response', async () => {
    let finish; const states = [];
    const pager = createWorkShiftPager(() => new Promise(r => { finish = r; }), s => states.push(s));
    const pending = pager.load(); pager.clear(); finish(receipt('old-account')); await pending;
    expect(states.at(-1)).toMatchObject({ shifts: [], canManage: false, loading: false }); pager.dispose();
  });
  it('bounds a stalled list request', async () => {
    vi.useFakeTimers(); const states = [];
    const pager = createWorkShiftPager(() => new Promise(() => {}), s => states.push(s));
    const pending = pager.load(); await vi.advanceTimersByTimeAsync(15000); await pending;
    expect(states.at(-1)).toMatchObject({ loading: false, shifts: [], canManage: false });
    expect(states.at(-1).error).toContain('timed out'); pager.dispose();
  });
});
