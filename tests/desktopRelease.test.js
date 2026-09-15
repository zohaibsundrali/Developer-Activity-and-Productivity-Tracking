import {afterEach, expect, it} from 'vitest';
import {parseDesktopRelease} from '@/utils/desktopRelease';
import {GET} from '@/app/api/desktop/download/route';
const good=()=>({schema_version:1,platform:'windows-x64',version:'1.1.0',configured:true,signed:true,
  acceptance:'windows_installed_passed',sha256:'a'.repeat(64),commit:'b'.repeat(40),bytes:36000000,
  publisher:'Example publisher',published_at:'2026-09-01T12:00:00Z',url:'https://downloads.example.com/v1.1.0/setup.exe'});
const original=process.env.DESKTOP_PUBLIC_RELEASE;
afterEach(()=>{if(original===undefined)delete process.env.DESKTOP_PUBLIC_RELEASE;else process.env.DESKTOP_PUBLIC_RELEASE=original;});
it('exposes only approved release display fields',()=>{const r=parseDesktopRelease(JSON.stringify({...good(),private_note:'do not show'}));expect(r.version).toBe('1.1.0');expect(r.private_note).toBeUndefined();expect(r.configured).toBeUndefined();});
it.each([{configured:false},{signed:false},{acceptance:'manual_windows_test_required'},{schema_version:2},
  {sha256:'bad'},{commit:'main'},{bytes:-1},{bytes:400*1024*1024},{version:'1.1.0-beta'},
  {platform:'darwin'},{publisher:''},{publisher:'bad\nvalue'},{published_at:'2099-01-01T00:00:00Z'},
  {published_at:'2026-09-01'}])('refuses incomplete release evidence %j',patch=>{expect(parseDesktopRelease(JSON.stringify({...good(),...patch}))).toBeNull();});
it.each(['http://downloads.example.com/setup.exe','https://user:pass@example.com/setup.exe',
  'https://example.com/setup.exe?token=private','https://example.com/setup.exe#fragment',
  'https://example.com/setup.zip','https://desktop-build.example.invalid/setup.exe','//evil.test/setup.exe'])('rejects invalid download URL %s',url=>{expect(parseDesktopRelease(JSON.stringify({...good(),url}))).toBeNull();});
it('fails closed for absent, malformed or oversized configuration',()=>{for(const value of [undefined,'{','null','x'.repeat(12001)])expect(parseDesktopRelease(value)).toBeNull();});
it('unavailable endpoint does not expose build details or a redirect',async()=>{process.env.DESKTOP_PUBLIC_RELEASE=JSON.stringify({...good(),configured:false});const r=GET();expect(r.status).toBe(503);expect(r.headers.get('Location')).toBeNull();expect(await r.text()).not.toContain('configured');expect(r.headers.get('Cache-Control')).toBe('no-store');});
it('redirects only to operator release URL and never caches stale availability',()=>{process.env.DESKTOP_PUBLIC_RELEASE=JSON.stringify(good());const r=GET(new Request('https://app.test/api/desktop/download?url=https://evil.test/setup.exe'));expect(r.status).toBe(302);expect(r.headers.get('Location')).toBe(good().url);expect(r.headers.get('Cache-Control')).toBe('no-store');delete process.env.DESKTOP_PUBLIC_RELEASE;expect(GET().status).toBe(503);});
