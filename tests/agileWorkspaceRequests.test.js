import { expect, it, vi } from 'vitest';
import { createAgileRequest, loadAgileProjects } from '@/utils/agileWorkspaceRequests';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
it('does not let an older project load overwrite the newer selected project',async()=>{
 const request=createAgileRequest(),old=deferred(),onResult=vi.fn(),onError=vi.fn();
 const args={isCurrent:()=>true,onStart:vi.fn(),onResult,onError};
 const first=request.run({...args,load:()=>old.promise});await request.run({...args,load:async()=>({project:'new'})});old.resolve({project:'old'});await first;
 expect(onResult).toHaveBeenCalledExactlyOnceWith({project:'new'});
});
it('ignores old failures after organization change or cleanup',async()=>{
 const request=createAgileRequest(),pending=deferred(),onError=vi.fn();
 const first=request.run({load:()=>pending.promise,isCurrent:()=>false,onStart:()=>{},onResult:vi.fn(),onError});request.cancel();pending.reject(new Error('old'));await first;expect(onError).not.toHaveBeenCalled();
});
it('reports current errors and rejects reload so a committed save can distinguish refresh failure',async()=>{
 const request=createAgileRequest(),onError=vi.fn();
 await expect(request.run({load:async()=>{throw new Error('offline');},isCurrent:()=>true,onStart:()=>{},onResult:vi.fn(),onError})).rejects.toThrow('offline');expect(onError).toHaveBeenCalledOnce();
});
it('throws a project database error instead of reporting no projects',async()=>{
 const q={select:()=>q,eq:()=>q,order:async()=>({error:new Error('denied')})};await expect(loadAgileProjects({from:()=>q},'org')).rejects.toThrow('denied');
});
it('uses the legacy archived fallback only for a missing archived column and still throws fallback errors',async()=>{
 const order=vi.fn().mockResolvedValueOnce({error:{code:'42703',message:'archived column missing'}}).mockResolvedValueOnce({error:new Error('fallback failed')});
 const q={select:()=>q,eq:()=>q,order};await expect(loadAgileProjects({from:()=>q},'org')).rejects.toThrow('fallback failed');expect(order).toHaveBeenCalledTimes(2);
});
