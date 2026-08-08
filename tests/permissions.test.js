import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Role-based access control. `can()` is the app-layer gate in front of every
 * destructive/administrative action, so a regression here silently widens
 * privileges. The role source (`getOrgContext`) is mocked so these stay pure —
 * no Supabase, no sessionStorage.
 */

vi.mock('@/utils/orgContext', () => ({
  getOrgContext: vi.fn(() => null),
}));

const { getOrgContext } = await import('@/utils/orgContext');
const { getRole, hasRole, atLeast, can } = await import('@/utils/permissions');

/** Pretend the current session carries `role`. Pass null for signed-out. */
function asRole(role) {
  getOrgContext.mockReturnValue(role ? { role } : null);
}

const ALL_ROLES = [
  'owner',
  'admin',
  'manager',
  'hr',
  'team_lead',
  'developer',
  'employee',
  'client',
];

beforeEach(() => {
  getOrgContext.mockReset();
  getOrgContext.mockReturnValue(null);
});

describe('getRole', () => {
  it('returns the role from the org context', () => {
    asRole('manager');
    expect(getRole()).toBe('manager');
  });

  it('returns null when there is no context', () => {
    asRole(null);
    expect(getRole()).toBeNull();
  });

  it('returns null when the context has no role', () => {
    getOrgContext.mockReturnValue({ organizationId: 'org-1' });
    expect(getRole()).toBeNull();
  });
});

describe('hasRole', () => {
  it('matches an exact role in the list', () => {
    asRole('hr');
    expect(hasRole('hr', 'admin')).toBe(true);
  });

  it('rejects a role that is not listed', () => {
    asRole('developer');
    expect(hasRole('hr', 'admin')).toBe(false);
  });

  it('rejects when signed out', () => {
    asRole(null);
    expect(hasRole('owner', 'admin', 'developer')).toBe(false);
  });
});

describe('atLeast (ROLE_RANK ordering)', () => {
  it('orders roles owner > admin > manager > hr > team_lead > developer > employee > client', () => {
    // Each role must satisfy atLeast for itself and everything below it.
    ALL_ROLES.forEach((role, index) => {
      asRole(role);
      ALL_ROLES.slice(index).forEach((lowerOrEqual) => {
        expect(atLeast(lowerOrEqual), `${role} should satisfy atLeast(${lowerOrEqual})`).toBe(true);
      });
      ALL_ROLES.slice(0, index).forEach((higher) => {
        expect(atLeast(higher), `${role} should NOT satisfy atLeast(${higher})`).toBe(false);
      });
    });
  });

  it('returns false when signed out regardless of the requested role', () => {
    asRole(null);
    expect(atLeast('client')).toBe(false);
    expect(atLeast('owner')).toBe(false);
  });

  it('fails closed for an unknown target role', () => {
    asRole('owner');
    // Unknown roles default to rank 99, above every real role.
    expect(atLeast('superadmin')).toBe(false);
  });

  it('fails closed for an unknown current role', () => {
    asRole('not-a-real-role');
    expect(atLeast('client')).toBe(false);
  });
});

describe('can — signed out', () => {
  it('denies everything, including the permissive default branch', () => {
    asRole(null);
    ['manage_org', 'manage_members', 'create_project', 'review_tasks', 'submit_task', 'anything_else'].forEach(
      (action) => expect(can(action)).toBe(false)
    );
  });
});

describe('can — owner-only actions', () => {
  const OWNER_ONLY = ['manage_org', 'manage_settings', 'delete_org'];

  it.each(OWNER_ONLY)('allows owner to %s', (action) => {
    asRole('owner');
    expect(can(action)).toBe(true);
  });

  it.each(OWNER_ONLY)('denies admin (and everyone below) %s', (action) => {
    ALL_ROLES.filter((r) => r !== 'owner').forEach((role) => {
      asRole(role);
      expect(can(action), `${role} must not ${action}`).toBe(false);
    });
  });
});

describe('can — people operations (owner, admin, hr)', () => {
  const PEOPLE_ACTIONS = [
    'manage_members',
    'invite_members',
    'create_developer',
    'delete_developer',
    'manage_employees',
    'manage_teams',
    'onboard_offboard',
    'transfer_employee',
    'activate_employee',
  ];
  const ALLOWED = ['owner', 'admin', 'hr'];

  it.each(PEOPLE_ACTIONS)('allows exactly owner/admin/hr to %s', (action) => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can(action), `${role} -> ${action}`).toBe(ALLOWED.includes(role));
    });
  });

  it('does not let a manager invite members or delete developers', () => {
    asRole('manager');
    expect(can('invite_members')).toBe(false);
    expect(can('delete_developer')).toBe(false);
  });
});

describe('can — project administration (owner, admin)', () => {
  const PROJECT_ACTIONS = ['create_project', 'delete_project', 'manage_automation'];
  const ALLOWED = ['owner', 'admin'];

  it.each(PROJECT_ACTIONS)('allows exactly owner/admin to %s', (action) => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can(action), `${role} -> ${action}`).toBe(ALLOWED.includes(role));
    });
  });

  it('does not let hr create or delete projects', () => {
    asRole('hr');
    expect(can('create_project')).toBe(false);
    expect(can('delete_project')).toBe(false);
  });
});

describe('can — task/team oversight (owner, admin, manager, team_lead)', () => {
  const SUPERVISOR_ACTIONS = [
    'review_tasks',
    'manage_tasks',
    'view_tracking',
    'view_reports',
    'view_team',
  ];
  const ALLOWED = ['owner', 'admin', 'manager', 'team_lead'];

  it.each(SUPERVISOR_ACTIONS)('allows exactly the supervisor set to %s', (action) => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can(action), `${role} -> ${action}`).toBe(ALLOWED.includes(role));
    });
  });

  it('denies a client any tracking or reporting visibility', () => {
    asRole('client');
    expect(can('view_tracking')).toBe(false);
    expect(can('view_reports')).toBe(false);
  });
});

describe('can — submit_task', () => {
  const ALLOWED = ['developer', 'employee', 'team_lead'];

  it('allows exactly developer/employee/team_lead', () => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can('submit_task'), `${role} -> submit_task`).toBe(ALLOWED.includes(role));
    });
  });
});

describe('can — unknown actions', () => {
  it('defaults to allow for any signed-in role (documented permissive default)', () => {
    // This is the current, deliberate behaviour: unlisted actions are not gated
    // here. Pinning it means an accidental change to the default is caught.
    asRole('client');
    expect(can('some_unlisted_action')).toBe(true);
  });

  it('never allows an unknown action while signed out', () => {
    asRole(null);
    expect(can('some_unlisted_action')).toBe(false);
  });
});
