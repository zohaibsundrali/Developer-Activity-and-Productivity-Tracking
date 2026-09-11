import { describe, expect, it, vi } from 'vitest';
import { createPreferenceRequests } from '@/utils/notificationPreferenceRequests';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
describe('preference request recovery', () => {
  it.each(['other-org:developer:same', 'org:admin:same', 'signed-out'])('ignores old loads and writes after identity changes to %s', async next => {
    let identity='org:developer:same'; const requests=createPreferenceRequests(()=>identity);
    const read=deferred(), write=deferred(), apply=vi.fn();
    const loading=requests.load(()=>read.promise, apply);
    const saving=requests.save('comment',()=>write.promise,apply);
    identity=next; read.resolve({preferences:{comment:false}}); write.resolve({error:new Error('denied')});
    await Promise.all([loading,saving]); expect(apply).not.toHaveBeenCalled();
    const send=vi.fn(); expect(await requests.save('review',send,apply)).toBe(false); expect(send).not.toHaveBeenCalled();
  });
  it('does not let an old load undo a saved choice', async()=>{
    const requests=createPreferenceRequests(()=>'org:developer:id'), read=deferred(), apply=vi.fn();
    const loading=requests.load(()=>read.promise,apply);
    await requests.save('comment',async()=>({error:null}),apply);
    read.resolve({preferences:{comment:true}}); await loading;
    expect(apply).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledWith({error:null});
  });
  it('handles thrown writes and releases the switch for retry',async()=>{
    const requests=createPreferenceRequests(()=>'identity'), apply=vi.fn();
    await requests.save('comment',async()=>{throw new Error('offline');},apply);
    expect(apply.mock.calls[0][0].error.message).toBe('offline'); expect(requests.canSave('comment')).toBe(true);
    await requests.save('comment',async()=>({error:null}),apply); expect(apply).toHaveBeenLastCalledWith({error:null});
  });
  it('allows independent switches and prevents duplicate writes',async()=>{
    const requests=createPreferenceRequests(()=>'identity'), write=deferred(), apply=vi.fn(), duplicate=vi.fn();
    const saving=requests.save('comment',()=>write.promise,apply);
    expect(requests.canSave('comment')).toBe(false); expect(requests.canSave('review')).toBe(true);
    expect(await requests.save('comment',duplicate,apply)).toBe(false); expect(duplicate).not.toHaveBeenCalled();
    write.resolve({error:null}); await saving;
  });
  it('does not complete an unmounted write after setup runs again', async()=>{
    const requests=createPreferenceRequests(()=>'identity'), write=deferred(), apply=vi.fn();
    const saving=requests.save('comment',()=>write.promise,apply); requests.dispose(); requests.activate();
    write.resolve({error:null}); await saving; expect(apply).not.toHaveBeenCalled();
  });
  it('reports read exceptions and rejects stale results after unmount/StrictMode setup',async()=>{
    const requests=createPreferenceRequests(()=>'identity'), apply=vi.fn(), read=deferred();
    await requests.load(async()=>{throw new Error('offline');},apply);
    expect(apply.mock.calls[0][0].error.message).toBe('offline'); apply.mockClear();
    const loading=requests.load(()=>read.promise,apply); requests.dispose(); requests.activate();
    read.resolve({preferences:{comment:false}}); await loading; expect(apply).not.toHaveBeenCalled();
  });
});
