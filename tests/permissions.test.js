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

// All eleven, in rank order. `designer` is EXCLUDED from the strict-ordering
// test below (and only from that one) because it shares a rank with
// `developer` on purpose — a test that demands a total order cannot also
// express a deliberate tie.
const ALL_ROLES = [
  'owner',
  'admin',
  'manager',
  'hr',
  'finance',
  'team_lead',
  'qa',
  'developer',
  'designer',
  'employee',
  'client',
];

const STRICTLY_ORDERED = ALL_ROLES.filter((r) => r !== 'designer');

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
  it('orders roles owner > admin > manager > hr > finance > team_lead > qa > developer > employee > client', () => {
    // Each role must satisfy atLeast for itself and everything below it.
    STRICTLY_ORDERED.forEach((role, index) => {
      asRole(role);
      STRICTLY_ORDERED.slice(index).forEach((lowerOrEqual) => {
        expect(atLeast(lowerOrEqual), `${role} should satisfy atLeast(${lowerOrEqual})`).toBe(true);
      });
      STRICTLY_ORDERED.slice(0, index).forEach((higher) => {
        expect(atLeast(higher), `${role} should NOT satisfy atLeast(${higher})`).toBe(false);
      });
    });
  });

  it('treats designer and developer as the same tier, in both directions', () => {
    asRole('designer');
    expect(atLeast('developer')).toBe(true);
    asRole('developer');
    expect(atLeast('designer')).toBe(true);
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
  // create_project deliberately left OUT of this list — it is no longer
  // owner/admin only. See the block below.
  const PROJECT_ACTIONS = ['delete_project', 'manage_automation'];
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
  // review_tasks deliberately NOT here: QA reviews too, so it has its own
  // block. Leaving it in this list would assert that QA cannot review, which
  // is the opposite of why the role exists.
  const SUPERVISOR_ACTIONS = [
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
  // Designer and QA file work the same way a developer does.
  const ALLOWED = ['developer', 'designer', 'qa', 'employee', 'team_lead'];

  it('allows exactly the people who do the work', () => {
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

describe('can — creating a project is the project manager\'s job', () => {
  // This used to be owner/admin only, which meant a PM could RUN a project but
  // not START one — every new piece of work had to queue behind a founder.
  const ALLOWED = ['owner', 'admin', 'manager', 'team_lead'];

  it('allows exactly the supervisor set to create_project', () => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can('create_project'), `${role} -> create_project`).toBe(ALLOWED.includes(role));
    });
  });

  it('still keeps DELETING a project to owner/admin', () => {
    // Starting work and destroying it are not the same decision.
    asRole('manager');
    expect(can('create_project')).toBe(true);
    expect(can('delete_project')).toBe(false);
    asRole('team_lead');
    expect(can('create_project')).toBe(true);
    expect(can('delete_project')).toBe(false);
  });

  it('does not hand it to a developer, designer, qa or client', () => {
    for (const role of ['developer', 'designer', 'qa', 'employee', 'client']) {
      asRole(role);
      expect(can('create_project'), role).toBe(false);
    }
  });
});

describe('can — review_tasks includes QA', () => {
  const ALLOWED = ['owner', 'admin', 'manager', 'team_lead', 'qa'];

  it('allows exactly the reviewer set', () => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can('review_tasks'), `${role} -> review_tasks`).toBe(ALLOWED.includes(role));
    });
  });

  it('gives QA the review right WITHOUT the rest of the oversight surface', () => {
    asRole('qa');
    expect(can('review_tasks')).toBe(true);
    expect(can('view_tracking')).toBe(false);
    expect(can('view_reports')).toBe(false);
    expect(can('create_project')).toBe(false);
  });
});

describe('can — finance sees money, not people', () => {
  const ALLOWED = ['owner', 'admin', 'finance'];

  it.each(['view_billing', 'manage_billing'])('allows exactly owner/admin/finance to %s', (action) => {
    ALL_ROLES.forEach((role) => {
      asRole(role);
      expect(can(action), `${role} -> ${action}`).toBe(ALLOWED.includes(role));
    });
  });

  it('does not give finance any monitoring or people access', () => {
    asRole('finance');
    expect(can('view_tracking')).toBe(false);
    expect(can('view_team')).toBe(false);
    expect(can('manage_employees')).toBe(false);
    expect(can('create_project')).toBe(false);
  });
});
