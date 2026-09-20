import { beforeEach, expect, it, vi } from 'vitest';
const { fetch }=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/utils/authFetch',()=>({authFetch:fetch}));
const {platformOwnerHome}=await import('@/utils/platformOwnerHome');
beforeEach(()=>vi.clearAllMocks());
it('only recognizes the explicit server capability',async()=>{fetch.mockResolvedValue({ok:true,json:async()=>({platformOwner:true})});expect(await platformOwnerHome()).toBe(true);});
it.each([{role:'owner'},{email:'zohaibawan6511@gmail.com'},{}])('does not infer platform access from account details',async body=>{fetch.mockResolvedValue({ok:true,json:async()=>body});expect(await platformOwnerHome()).toBe(false);});
it('retains regular login on access service failure',async()=>{fetch.mockRejectedValue(new Error('offline'));expect(await platformOwnerHome()).toBe(false);});
