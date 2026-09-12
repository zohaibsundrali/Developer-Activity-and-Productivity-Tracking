import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ auth: { signOut: vi.fn(), stopAutoRefresh: vi.fn() }, removeAllChannels: vi.fn() }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: sdk, SUPABASE_AUTH_STORAGE_KEY: 'sb-current-auth-token' }));
vi.mock('@/utils/permissions', () => ({ clearPermissionSet: vi.fn() }));
import { clearPermissionSet } from '@/utils/permissions';
import { clearBrowserAuthentication, logoutAndRedirect } from '@/utils/browserLogout';
function storage() {
  const entries = new Map();
  return {getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
}
let browser;
beforeEach(()=>{
  vi.useFakeTimers(); vi.clearAllMocks();
  browser={sessionStorage:storage(),localStorage:storage(),dispatchEvent:vi.fn(),location:{href:'/client'}};
  vi.stubGlobal('window',browser);vi.stubGlobal('document',{cookie:''});
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true})));
  sdk.auth.signOut.mockResolvedValue({error:null});sdk.auth.stopAutoRefresh.mockResolvedValue();sdk.removeAllChannels.mockResolvedValue([]);
  for(const store of [browser.sessionStorage,browser.localStorage]) {
    for(const key of ['adminUser','developerUser','clientUser','auth_token','user_data','sb-current-auth-token','sb-current-auth-token-code-verifier','sb-current-auth-token-user']) store.setItem(key,'old identity');
    store.setItem('deletion-receipt','keep');store.setItem('editor-draft','keep');store.setItem('sb-unrelated-auth-token','keep');
  }
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function expectCleared() {
  for(const store of [browser.sessionStorage,browser.localStorage]) {
    for(const key of ['adminUser','developerUser','clientUser','auth_token','user_data','sb-current-auth-token','sb-current-auth-token-code-verifier','sb-current-auth-token-user']) expect(store.getItem(key)).toBeNull();
    expect(store.getItem('deletion-receipt')).toBe('keep');expect(store.getItem('editor-draft')).toBe('keep');expect(store.getItem('sb-unrelated-auth-token')).toBe('keep');
  }
}
describe('complete browser logout',()=>{
  it('clears every app identity and this SDK project before hard navigation',async()=>{
    await logoutAndRedirect();expectCleared();expect(browser.location.href).toBe('/login');
    expect(clearPermissionSet).toHaveBeenCalled();expect(sdk.auth.signOut).toHaveBeenCalledOnce();expect(sdk.auth.signOut).toHaveBeenCalledWith({scope:'local'});expect(sdk.auth.stopAutoRefresh).toHaveBeenCalledOnce();expect(sdk.removeAllChannels).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/auth/session',{method:'DELETE',keepalive:true});
  });
  it('waits for remote revocation instead of aborting it with immediate navigation',async()=>{
    let finish;sdk.auth.signOut.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const done=logoutAndRedirect();await Promise.resolve();
    expect(browser.sessionStorage.getItem('clientUser')).toBeNull();expect(browser.location.href).toBe('/client');
    finish({error:null});await done;expectCleared();expect(browser.location.href).toBe('/login');
  });
  it.each(['returned error','rejection'])('forces local SDK cleanup on %s',async failure=>{
    if(failure==='rejection') sdk.auth.signOut.mockRejectedValue(new Error('offline'));
    else sdk.auth.signOut.mockResolvedValue({error:new Error('offline')});
    fetch.mockRejectedValue(new Error('offline'));
    await logoutAndRedirect();expectCleared();expect(browser.location.href).toBe('/login');
  });
  it('bounds hung revocation/cookie/channel requests and still leaves the document',async()=>{
    sdk.auth.signOut.mockImplementation(()=>new Promise(()=>{}));sdk.removeAllChannels.mockImplementation(()=>new Promise(()=>{}));fetch.mockImplementation(()=>new Promise(()=>{}));
    const done=logoutAndRedirect();await vi.advanceTimersByTimeAsync(1499);expect(browser.location.href).toBe('/client');
    await vi.advanceTimersByTimeAsync(1);await done;expectCleared();expect(browser.location.href).toBe('/login');
  });
  it('coalesces duplicate logout clicks without duplicate revocation requests',async()=>{
    const first=clearBrowserAuthentication(),second=clearBrowserAuthentication();expect(first).toBe(second);
    await Promise.all([first,second]);expect(sdk.auth.signOut).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
  });
  it('still navigates when browser storage is inaccessible',async()=>{
    Object.defineProperty(browser,'sessionStorage',{get(){throw new Error('blocked');}});
    await logoutAndRedirect();expect(browser.location.href).toBe('/login');
  });
});
