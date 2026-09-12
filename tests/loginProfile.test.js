import { describe, it, expect, vi } from 'vitest';
import { loadLoginProfile } from '@/utils/loginProfile';

const user = { id: 'auth-a', app_metadata: { user_type: 'developer', app_user_id: 'profile-a', organization_id: 'org-a' } };
const profile = { id: 'profile-a', organization_id: 'org-a', auth_user_id: 'auth-a' };
function clientFor(result) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result) };
  return { client: { from: vi.fn(() => query) }, query };
}

describe('login workspace identity', () => {
  it('requires a successful Auth identity before reading any profile', async () => {
    const { client } = clientFor({ data: profile });
    await expect(loadLoginProfile(client, null, 'developer')).rejects.toThrow('Invalid email or password');
    expect(client.from).not.toHaveBeenCalled();
  });
  it('does not query another portal table', async () => {
    const { client } = clientFor({ data: profile });
    await expect(loadLoginProfile(client, user, 'admin')).rejects.toThrow('account type');
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each(['organization_id', 'app_user_id'])('requires the trusted %s claim', async field => {
    const { client } = clientFor({ data: profile });
    await expect(loadLoginProfile(client, { ...user, app_metadata: { ...user.app_metadata, [field]: null } }, 'developer')).rejects.toThrow('setup');
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each(['admin', 'developer', 'client'])('loads the exact linked %s profile, independent of email casing', async type => {
    const { client, query } = clientFor({ data: profile });
    await expect(loadLoginProfile(client, { ...user, email: 'UPPER@example.com', app_metadata: { ...user.app_metadata, user_type: type } }, type)).resolves.toEqual(profile);
    expect(client.from).toHaveBeenCalledWith({ admin: 'admin_users', developer: 'developers', client: 'clients' }[type]);
    expect(query.eq.mock.calls).toEqual([['id', 'profile-a'], ['organization_id', 'org-a'], ['auth_user_id', 'auth-a']]);
  });
  it.each([null, { ...profile, auth_user_id: null }, { ...profile, auth_user_id: 'other' }, { ...profile, organization_id: 'other' }, { ...profile, id: 'other' }])('refuses missing or mismatched linkage', async data => {
    const { client } = clientFor({ data });
    await expect(loadLoginProfile(client, user, 'developer')).rejects.toThrow('administrator');
  });
  it('reports lookup outage without exposing raw database errors', async () => {
    const { client, query } = clientFor({ error: { message: 'private database detail' } });
    await expect(loadLoginProfile(client, user, 'developer')).rejects.toThrow('Please try again');
    query.maybeSingle.mockRejectedValue(new Error('private database detail'));
    await expect(loadLoginProfile(client, user, 'developer')).rejects.toThrow('Please try again');
  });
});
