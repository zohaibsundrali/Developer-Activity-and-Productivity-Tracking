import { expect, it } from 'vitest';
import { classifyShiftAttendance as classify } from '@/utils/shiftAttendanceExceptions';
const id='99100000-0000-0000-0000-000000000001';
const base=()=>({shift:{id,timezone:'UTC',status:'published',start_at:'2026-09-14T09:00:00Z',end_at:'2026-09-14T17:00:00Z'},attendance:[],leave:[],neighbours:[]});
const clock=(start='2026-09-14T09:00:00Z',end='2026-09-14T17:00:00Z')=>({id,work_date:'2026-09-14',status:'present',check_in_at:start,check_out_at:end});
it('flags a missed ended shift when no clocks or leave exist',()=>{expect(classify(base(),5,5).flags).toEqual(['missed_shift']);});
it('accepts exact grace and flags one second beyond it without deducting grace',()=>{const s=base();s.attendance=[clock('2026-09-14T09:05:00Z','2026-09-14T16:55:00Z')];expect(classify(s,5,5).outcome).toBe('on_time');s.attendance=[clock('2026-09-14T09:05:01Z','2026-09-14T16:54:59Z')];expect(classify(s,5,5)).toMatchObject({flags:['late_arrival','early_departure'],late_seconds:301,early_seconds:301});});
it('never invents a checkout for an open clock',()=>{const s=base();s.attendance=[clock(undefined,null)];expect(classify(s,5,5).flags).toEqual(['missing_checkout']);});
it('routes a daily clock spanning split shifts to manual review',()=>{const s=base();s.attendance=[clock()];s.neighbours=[{id,start_at:'2026-09-14T13:00:00Z',end_at:'2026-09-14T18:00:00Z'}];expect(classify(s,5,5).outcome).toBe('manual_review');});
it('does not assign an adjacent shift clock twice at its exact boundary',()=>{const s=base();s.attendance=[clock()];s.neighbours=[{id,start_at:'2026-09-14T17:00:00Z',end_at:'2026-09-14T20:00:00Z'}];expect(classify(s,5,5).outcome).toBe('on_time');});
it('requires all local shift dates to be covered by full-day leave',()=>{const s=base();s.shift.timezone='Asia/Karachi';s.shift.start_at='2026-09-14T18:00:00Z';s.shift.end_at='2026-09-15T02:00:00Z';s.leave=[{id,start_date:'2026-09-14',end_date:'2026-09-14',days:1}];expect(classify(s,5,5).outcome).toBe('manual_review');s.leave[0].end_date='2026-09-15';s.leave[0].days=2;expect(classify(s,5,5).outcome).toBe('approved_leave');});
it('does not infer which hours a half day covers',()=>{const s=base();s.leave=[{id,start_date:'2026-09-14',end_date:'2026-09-14',days:0.5}];expect(classify(s,5,5).outcome).toBe('manual_review');});
it('routes leave and actual work conflicts to review',()=>{const s=base();s.leave=[{id,start_date:'2026-09-14',end_date:'2026-09-14',days:1}];s.attendance=[clock()];expect(classify(s,5,5).outcome).toBe('manual_review');});
it('handles DST overnight shifts with real instants',()=>{const s=base();s.shift.timezone='Europe/Berlin';s.shift.start_at='2026-10-24T20:00:00Z';s.shift.end_at='2026-10-25T05:00:00Z';s.attendance=[{...clock(s.shift.start_at,s.shift.end_at),work_date:'2026-10-24'}];expect(classify(s,5,5).outcome).toBe('on_time');});
it('refuses malformed clocks rather than calling the shift missed',()=>{const s=base();s.attendance=[clock('bad')];expect(()=>classify(s,5,5)).toThrow();});
it('does not mistake an out-of-window daily clock for absence',()=>{const s=base();s.attendance=[clock('2026-09-14T18:00:00Z','2026-09-14T19:00:00Z')];expect(classify(s,5,5).outcome).toBe('manual_review');});

it("flags a fraction of a second beyond the configured grace",()=>{const s=base();s.attendance=[clock("2026-09-14T09:05:00.001Z")];expect(classify(s,5,5).flags).toContain("late_arrival");});
