import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/utils/orgFiles', () => ({ resolveOrgFileUrl: mocks.resolve }));
import { safeProjectFileValue, resolveProjectFileUrl } from '@/utils/projectFiles';
const path = '00000000-0000-0000-0000-000000000001/project-docs/file.pdf';
beforeEach(() => mocks.resolve.mockReset());
describe('project file navigation', () => {
  it('signs a persisted private project document before returning a navigation URL', async () => {
    mocks.resolve.mockResolvedValue('https://storage.example/signed/file?token=test');
    expect(await resolveProjectFileUrl(path)).toBe('https://storage.example/signed/file?token=test');
    expect(mocks.resolve).toHaveBeenCalledWith(path);
  });
  it('retains the existing legacy HTTPS URL contract', async () => {
    expect(await resolveProjectFileUrl('https://legacy.example/file.pdf')).toBe('https://legacy.example/file.pdf');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('retains safe site-relative legacy URLs', async () => {
    expect(await resolveProjectFileUrl('/documents/file.pdf')).toBe('/documents/file.pdf');
  });
  it.each(['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,attack', 'not-a-file', path.replace('file.pdf','../file.pdf')])('refuses unsafe or malformed value %s', async value => {
    expect(safeProjectFileValue(value)).toBe('');
    expect(await resolveProjectFileUrl(value)).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('does not fall back to navigating a private key when signing fails', async () => {
    mocks.resolve.mockResolvedValue(null);
    expect(await resolveProjectFileUrl(path)).toBeNull();
  });
  it('checks the signed result before navigation', async () => {
    mocks.resolve.mockResolvedValue('javascript:alert(1)');
    expect(await resolveProjectFileUrl(path)).toBeNull();
  });
});
