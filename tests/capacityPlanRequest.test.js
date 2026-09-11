import { expect, it, vi } from 'vitest';
import { createCapacityPlanRequest } from '@/utils/capacityPlanRequest';
const deferred = () => { let resolve; let reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const ok = rows => ({ok:true,json:async()=>({success:true,rows})});
it('never replaces a new selected week with a slower prior response',async()=>{
 const old=deferred(),next=deferred();const publish=vi.fn();
 const fetcher=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
 const request=createCapacityPlanRequest(fetcher,publish);
 const a=request.load('2026-09-07','org:old');const b=request.load('2026-09-14','org:next');
 expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
 next.resolve(ok(['next']));await b;old.resolve(ok(['old']));await a;
 expect(publish).toHaveBeenLastCalledWith({scope:'org:next',loading:false,rows:['next'],error:''});
 expect(publish.mock.calls.some(([state])=>state.rows.includes('old'))).toBe(false);
});
it('ignores old failures after switching weeks or retrying',async()=>{
 const old=deferred();const publish=vi.fn();const request=createCapacityPlanRequest(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok(['retry'])),publish);
 const a=request.load('2026-09-07','week');await request.load('2026-09-07','week');old.reject(new Error('old failure'));await a;
 expect(publish).toHaveBeenLastCalledWith({scope:'week',loading:false,rows:['retry'],error:''});
});
it('cancels state publication on unmount and allows a fresh StrictMode request',async()=>{
 const old=deferred();const publish=vi.fn();const request=createCapacityPlanRequest(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok([])),publish);
 const a=request.load('2026-09-07','week');request.cancel();old.resolve(ok(['old']));await a;
 expect(publish).toHaveBeenCalledTimes(1);await request.load('2026-09-14','future');
 expect(publish).toHaveBeenLastCalledWith({scope:'future',loading:false,rows:[],error:''});
});
it('clears rows and exposes the current request failure',async()=>{
 const publish=vi.fn();const request=createCapacityPlanRequest(async()=>({ok:false,json:async()=>({error:'Permission denied'})}),publish);
 await request.load('2026-09-07','week');expect(publish).toHaveBeenLastCalledWith({scope:'week',loading:false,rows:[],error:'Permission denied'});
});
