import { expect, it, vi } from 'vitest';
import { planningStoryPoints, sprintDateOrder, performPlanningEdit } from '@/utils/sprintPlanningEdits';
it('retains forms on a refused write without reloading',async()=>{
 const reload=vi.fn(),onError=vi.fn();
 expect(await performPlanningEdit({mutate:async()=>({error:new Error('denied')}),reload,onError,title:'Save failed'})).toBe(false);
 expect(reload).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledWith('Save failed','denied');
});
it('does not encourage duplicate create when only post-save refresh failed',async()=>{
 const mutate=vi.fn(async()=>({sprint:{id:'saved'}})),onError=vi.fn();
 expect(await performPlanningEdit({mutate,reload:async()=>{throw new Error('offline');},onError})).toBe(true);
 expect(mutate).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledWith('Saved, but could not refresh',expect.stringContaining('saved'));
});
it('treats thrown write failures as unsaved',async()=>{
 expect(await performPlanningEdit({mutate:async()=>{throw new Error('offline');},onError:vi.fn()})).toBe(false);
});
it.each(['-1','1.5','abc','Infinity','2147483648'])('rejects invalid integer story points %s',value=>{expect(()=>planningStoryPoints(value)).toThrow();});
it('preserves zero and nullable story points',()=>{expect(planningStoryPoints('')).toBeNull();expect(planningStoryPoints('0')).toBe(0);expect(planningStoryPoints('13')).toBe(13);});
it('validates date ordering without requiring optional dates',()=>{expect(sprintDateOrder('2026-09-11','2026-09-10')).toBe(false);expect(sprintDateOrder('2026-09-11','2026-09-11')).toBe(true);expect(sprintDateOrder('', '2026-09-11')).toBe(true);});
