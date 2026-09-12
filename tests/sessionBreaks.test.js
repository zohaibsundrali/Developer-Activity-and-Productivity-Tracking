import { describe, it, expect } from 'vitest';
import { sessionBreakSummary, breakDuration } from '../src/utils/sessionBreaks';
const closed = {id:'break1',started_at:'2026-09-12T08:00:00Z',ended_at:'2026-09-12T08:01:00Z',duration_seconds:60};
describe('recorded breaks', () => {
  it('distinguishes legacy missing history from explicitly empty history', () => {
    expect(sessionBreakSummary({}).available).toBe(false);
    expect(sessionBreakSummary({break_periods:[],break_duration:0}).available).toBe(true);
  });
  it('does not infer an interrupted break end or duration', () => {
    const result = sessionBreakSummary({break_periods:[closed,{...closed,id:'break2',ended_at:null,duration_seconds:0}],break_duration:60});
    expect(result.open).toBe(true); expect(result.seconds).toBe(60);
  });
  it.each([NaN,Infinity,-1,'60'])('rejects malformed durations %s', value => {
    expect(sessionBreakSummary({break_periods:[closed],break_duration:value}).available).toBe(false);
  });
  it('keeps measured duration when the device wall clock moves', () => {
    const result=sessionBreakSummary({break_periods:[{...closed,ended_at:'2026-09-12T07:59:00Z'}],break_duration:60});
    expect(result.available).toBe(true); expect(breakDuration(result.seconds)).toBe('0h 1m 0s');
  });
});
