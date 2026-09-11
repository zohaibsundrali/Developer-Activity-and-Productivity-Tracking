import { expect,it } from 'vitest';
import { leaveDayAmount } from '@/utils/leaveDayContract';
it('preserves inclusive calendar spans and single-date half days',()=>{expect(leaveDayAmount(1,0.5)).toBe(.5);expect(leaveDayAmount(1,1)).toBe(1);expect(leaveDayAmount(3,3)).toBe(3);expect(leaveDayAmount(3,undefined)).toBe(3);});
it.each([.5,1,1.5,2,2.5,3.5])('rejects forged aggregate amount %s for three dates',days=>{expect(leaveDayAmount(3,days)).toBeNull();});
it.each([true,false,null,[],{},NaN,Infinity,'',.1,.25,.75,-1])('rejects malformed or unsupported single-date amount %s',days=>{expect(leaveDayAmount(1,days)).toBeNull();});
