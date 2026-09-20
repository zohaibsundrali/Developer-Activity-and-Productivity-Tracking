import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@playwright/test', () => ({ test: { skip: vi.fn() } }));
import { credentialsFor, ROLES } from '../e2e/fixtures/credentials';
import { dashboardHomeFor } from '@/utils/dashboardHome';
import { userTypeForRole } from '@/utils/roles';

afterEach(() => vi.unstubAllEnvs());
describe('E2E login expectations match automatic membership-role routing', () => {
  it.each(Object.keys(ROLES))('%s reaches its real dashboard without portal override', role => {
    const prefix = ROLES[role].prefix;
    vi.stubEnv(`${prefix}_EMAIL`, 'qa@example.test');
    vi.stubEnv(`${prefix}_PASSWORD`, 'test-placeholder');
    vi.stubEnv(`${prefix}_PORTAL`, '');
    const membership = role === 'orgBOwner' ? 'owner' : role;
    const credentials = credentialsFor(role);
    expect(credentials.ok).toBe(true);
    expect(credentials.landing).toBe(dashboardHomeFor(userTypeForRole(membership), membership));
    expect(credentials).not.toHaveProperty('tab');
  });
  it('an explicit portal remains an expected destination override', () => {
    vi.stubEnv('E2E_MANAGER_EMAIL', 'qa@example.test');
    vi.stubEnv('E2E_MANAGER_PASSWORD', 'test-placeholder');
    vi.stubEnv('E2E_MANAGER_PORTAL', 'admin');
    expect(credentialsFor('manager')).toMatchObject({ landing: '/admin/dashboard', area: 'admin' });
  });
});

it('pins disposable roles to their explicit organization without mixing tenants', () => {
  vi.stubEnv('E2E_QA_ORG_A_ID', 'org-a');
  vi.stubEnv('E2E_QA_ORG_B_ID', 'org-b');
  for (const role of ['owner', 'orgBOwner']) {
    const prefix = ROLES[role].prefix;
    vi.stubEnv(`${prefix}_EMAIL`, 'qa@example.test');
    vi.stubEnv(`${prefix}_PASSWORD`, 'test-placeholder');
    vi.stubEnv(`${prefix}_ORGANIZATION_ID`, '');
    expect(credentialsFor(role).organizationId).toBe(role === 'owner' ? 'org-a' : 'org-b');
  }
  vi.stubEnv('E2E_OWNER_ORGANIZATION_ID', 'explicit-owner-org');
  expect(credentialsFor('owner').organizationId).toBe('explicit-owner-org');
});
