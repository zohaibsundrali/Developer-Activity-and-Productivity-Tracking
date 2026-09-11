import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWeeklyHours, saveCapacityWeeklyHours } from '@/utils/capacityWeeklyHours';
const options = (extra = {}) => ({ allowed: () => true, userId: 'same', userType: 'admin', value: '24.5', ...extra });
const response = (profile, status = 200) => ({ ok: status === 200, status, json: async () => ({ success: status === 200, profile }) });
it.each(['', '  ', null])('preserves nullable clearing %j', value => { expect(parseWeeklyHours(value)).toBeNull(); });
it.each(['0', '-1', '169', 'abc', 'Infinity'])('rejects invalid hours %s', value => { expect(() => parseWeeklyHours(value)).toThrow(); });
it.each(['24.555', 24.555, '0.001'])('rejects hours that the database would round %s', value => { expect(() => parseWeeklyHours(value)).toThrow('two decimal'); });
it.each([true, false, [], [24], {}, undefined])('rejects coercible nonnumeric input %j', value => { expect(() => parseWeeklyHours(value)).toThrow(); });
it.each(['24.55', 24.55, '24.550', '1.01', 168])('accepts exact two-decimal values %s', value => { expect(parseWeeklyHours(value)).toBe(Number(value)); });
it('sends typed decimal hours and confirms only the corresponding profile', async () => {
 const profile={id:'profile',user_id:'same',user_type:'admin',weekly_hours:'24.5'};
 const fetcher=vi.fn(async()=>response(profile));
 expect(await saveCapacityWeeklyHours(options({fetcher}))).toBe(profile);
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({userId:'same',userType:'admin',weeklyHours:24.5});
});
it('sends null to clear rather than assigning default hours', async()=>{
 const fetcher=vi.fn(async()=>response({id:'profile',user_id:'same',user_type:'admin',weekly_hours:null}));
 await saveCapacityWeeklyHours(options({fetcher,value:''}));expect(JSON.parse(fetcher.mock.calls[0][1].body).weeklyHours).toBeNull();
});
it('rechecks effective hours permission before making a request',async()=>{
 const fetcher=vi.fn();const allowed=vi.fn(()=>false);
 await expect(saveCapacityWeeklyHours(options({fetcher,allowed}))).rejects.toThrow('permission');
 expect(allowed).toHaveBeenCalledWith('employment.set_hours');expect(fetcher).not.toHaveBeenCalled();
});
it('does not report success for another profile with the same ID',async()=>{
 await expect(saveCapacityWeeklyHours(options({fetcher:async()=>response({id:'profile',user_id:'same',user_type:'developer',weekly_hours:24.5})}))).rejects.toThrow('confirm');
});
it('reports missing employee profiles without attempting to create them',async()=>{
 const fetcher=vi.fn(async()=>response(null,404));
 await expect(saveCapacityWeeklyHours(options({fetcher}))).rejects.toThrow('employee profile');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('reports absent or mismatched confirmation instead of claiming save',async()=>{
 for(const profile of [null,{id:'profile',user_id:'same',user_type:'admin',weekly_hours:40}]) {
  await expect(saveCapacityWeeklyHours(options({fetcher:async()=>response(profile)}))).rejects.toThrow('confirm');
 }
});
it('wires the independently gated typed editor to confirmed-save reload',()=>{
 const source=readFileSync(new URL('../src/components/admin/CapacityPlan.jsx',import.meta.url),'utf8');
 expect(source).toContain("allowed('employment.set_hours')");
 expect(source).toContain('userType: hoursEditor.userType');
 expect(source).toContain('await saveCapacityWeeklyHours(');
 expect(source).toContain('setHoursEditor(null); await load();');
 expect(source).toContain("r.weekly_hours == null ? '' : String(r.weekly_hours)");
});
