import { expect,it,vi } from 'vitest';
import { readDeletionStatus,createDeletionRequestGuard } from '@/utils/organizationDeletionRequests';
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
it.each([401,403])('uses the read-only receipt after authenticated %s',async status=>{
 const authenticatedFetch=vi.fn(async()=>response(status,{})),publicFetch=vi.fn(async()=>response(200,{job:{status:'completed'}}));
 expect(await readDeletionStatus({authenticatedFetch,publicFetch,receipt:'token & secret'})).toEqual({job:{status:'completed'}});
 expect(publicFetch).toHaveBeenCalledWith('/api/organizations/delete?receipt=token%20%26%20secret',{cache:'no-store'});
});
it('recovers when removed credentials make authenticated fetch throw',async()=>{
 const publicFetch=vi.fn(async()=>response(200,{job:{stage:'auth'}}));
 expect(await readDeletionStatus({authenticatedFetch:async()=>{throw Error('no session');},publicFetch,receipt:'receipt'})).toEqual({job:{stage:'auth'}});
});
it('keeps authenticated retry permission and never falls back on an unrelated server error',async()=>{
 const publicFetch=vi.fn();
 expect(await readDeletionStatus({authenticatedFetch:async()=>response(200,{canDelete:true,job:{status:'retry'}}),publicFetch,receipt:'receipt'})).toHaveProperty('canDelete',true);
 await expect(readDeletionStatus({authenticatedFetch:async()=>response(503,{error:'Unavailable'}),publicFetch,receipt:'receipt'})).rejects.toThrow('Unavailable');
 expect(publicFetch).not.toHaveBeenCalled();
});
it('hides unauthorized controls without a receipt and propagates invalid receipt errors',async()=>{
 expect(await readDeletionStatus({authenticatedFetch:async()=>response(403,{}),publicFetch:vi.fn(),receipt:''})).toBeNull();
 await expect(readDeletionStatus({authenticatedFetch:async()=>response(401,{}),publicFetch:async()=>response(404,{error:'Receipt unavailable'}),receipt:'bad'})).rejects.toThrow('Receipt unavailable');
});
it('rejects old-org results even before effect cleanup, older refreshes and unmounted work',()=>{
 let scope='org-A';const guard=createDeletionRequestGuard(()=>scope);const old=guard.begin();scope='org-B';expect(guard.current(old)).toBe(false);
 const first=guard.begin(),second=guard.begin();expect(guard.current(first)).toBe(false);expect(guard.current(second)).toBe(true);guard.invalidate();expect(guard.current(second)).toBe(false);
});

it('hides a surfaced forbidden error for nonowners without a receipt',async()=>{
 expect(await readDeletionStatus({authenticatedFetch:async()=>{throw Object.assign(new Error('Forbidden'),{status:403});},publicFetch:vi.fn(),receipt:''})).toBeNull();
});
