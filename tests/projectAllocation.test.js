import { expect, it, vi } from 'vitest';
import { saveProjectAllocation } from '../src/utils/projectAllocation';
const target = { projectId: 'project', userId: 'same-id', userType: 'developer' };
const responder = (allocation_pct, extra = {}) => vi.fn(async () => ({ ok: true, json: async () => ({ success: true, member: { id: 'row', user_id: target.userId, user_type: target.userType, project_id: target.projectId, allocation_pct, ...extra } }) }));
it.each([['0',0],['100',100],['42',42],['',null]])('saves %s as %s with typed allocation-only payload', async (value,pct) => {
 const fetcher = responder(pct); await saveProjectAllocation(fetcher, { ...target, value });
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ ...target, allocationPct: pct });
 expect(fetcher.mock.calls[0][0]).toBe('/api/capacity'); expect(fetcher.mock.calls[0][1].method).toBe('PATCH');
});
it.each(['-1','101','1.5','x','1e2'])('rejects invalid allocation %s before write', async value => {
 const fetcher = responder(1); await expect(saveProjectAllocation(fetcher,{ ...target,value })).rejects.toThrow('whole number'); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a response for the colliding other profile', async () => {
 await expect(saveProjectAllocation(responder(25,{ user_type: 'admin' }),{ ...target,value:'25' })).rejects.toThrow('confirm');
});
it('rejects mismatched project, missing ID, and unconfirmed value', async () => {
 for (const extra of [{project_id:'other'},{id:null},{allocation_pct:0}]) await expect(saveProjectAllocation(responder(25,extra),{ ...target,value:'25' })).rejects.toThrow('confirm');
});
it('surfaces denied response without claiming saved', async () => {
 const fetcher = vi.fn(async () => ({ ok: false,json: async () => ({ error: 'Permission denied' }) }));
 await expect(saveProjectAllocation(fetcher,{ ...target,value:'25' })).rejects.toThrow('Permission denied');
});
