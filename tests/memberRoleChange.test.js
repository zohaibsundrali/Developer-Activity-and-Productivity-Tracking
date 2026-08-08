import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Role changes — the authorisation matrix, the write order, and the claim merge.
 *
 * A member's role is stored twice: `memberships.role` (what the app reads) and
 * app_metadata.role in the Supabase Auth user (what RLS reads, via
 * public.auth_role() — migration 018). Before /api/admin/members/role existed
 * the browser wrote only the first, so a demotion never took effect: the JWT
 * claim stayed privileged, the demoted account kept passing every RLS check,
 * and it could put its own role back. These tests pin the three things that
 * keep that closed —
 *   1. who may change whose role (authorize.js),
 *   2. that a partial failure lands on the RESTRICTIVE side (write order),
 *   3. that updating the claim preserves organization_id / user_type /
 *      app_user_id — dropping organization_id would make auth_org() return null
 *      and lock the member out of their own org.
 */

vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock('@/utils/systemEvents', () => ({
  recordEvent: vi.fn(async () => true),
}));

const { getAuthedOrg, serviceClient } = await import('@/utils/serverAuth');
const { authorizeRoleChange, writeClaimFirst, VALID_ROLES, ROLE_RANK } = await import(
  '@/app/api/admin/members/role/authorize'
);
const { POST } = await import('@/app/api/admin/members/role/route');

const ORG = 'org-1';

/** A verified caller, as getAuthedOrg() returns them. */
function actor(role, overrides = {}) {
  return {
    token: 't',
    userId: 'auth-actor',
    email: 'actor@example.com',
    orgId: ORG,
    role,
    userType: 'admin',
    appUserId: 'actor-app-id',
    ...overrides,
  };
}

/** A membership row, as the route reads it. */
function member(role, overrides = {}) {
  return {
    id: 'mem-1',
    organization_id: ORG,
    user_id: 'target-app-id',
    user_type: 'developer',
    email: 'target@example.com',
    role,
    ...overrides,
  };
}

const allow = (a, m, newRole) => authorizeRoleChange({ actor: a, membership: m, newRole });

// ── The fake service client ───────────────────────────────────────────────
// Records the ORDER of the two writes, because which one goes first is the
// whole safety argument, and the exact app_metadata object handed to
// updateUserById, because the merge is the other half.
function makeSvc({ membership, profile, claims, fail = {} }) {
  const calls = { order: [], rowUpdates: [], claimUpdates: [] };

  const query = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () =>
        table === 'memberships'
          ? { data: membership, error: fail.read ? { message: 'read failed' } : null }
          : { data: profile, error: null },
      update: (values) => {
        const p = {
          eq: () => p,
          then: (resolve, reject) => {
            calls.order.push('membership_row');
            if (fail.row) {
              return Promise.resolve({ error: { message: 'row failed' } }).then(resolve, reject);
            }
            calls.rowUpdates.push(values);
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return p;
      },
    };
    return q;
  };

  const svc = {
    from: (table) => query(table),
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: 'auth-target', app_metadata: claims } },
          error: null,
        }),
        updateUserById: async (id, attrs) => {
          calls.order.push('auth_claim');
          if (fail.claim) return { error: { message: 'claim failed' } };
          calls.claimUpdates.push({ id, attrs });
          return { error: null };
        },
      },
    },
  };

  return { svc, calls };
}

/** Drive POST with a verified caller and a fake database. */
async function post({ auth, membership, profile, claims, body, fail }) {
  getAuthedOrg.mockResolvedValue(auth);
  const { svc, calls } = makeSvc({
    membership,
    profile: profile === undefined ? { id: 'target-app-id', organization_id: ORG, auth_user_id: 'auth-target' } : profile,
    claims:
      claims === undefined
        ? {
            organization_id: ORG,
            role: membership?.role,
            user_type: 'developer',
            app_user_id: 'target-app-id',
          }
        : claims,
    fail,
  });
  serviceClient.mockReturnValue(svc);

  const request = { json: async () => body };
  const res = await POST(request);
  return { res, json: await res.json(), calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the role vocabulary', () => {
  it('accepts exactly the 8 roles the memberships CHECK constraint allows', () => {
    expect([...VALID_ROLES].sort()).toEqual(
      ['admin', 'client', 'developer', 'employee', 'hr', 'manager', 'owner', 'team_lead'].sort()
    );
  });

  it('ranks owner above admin above hr above developer', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.hr);
    expect(ROLE_RANK.hr).toBeGreaterThan(ROLE_RANK.developer);
  });
});

describe('authorizeRoleChange — who may act at all', () => {
  it('refuses an unauthenticated caller', () => {
    expect(allow(null, member('developer'), 'manager')).toMatchObject({ ok: false, status: 401 });
  });

  it.each(['manager', 'team_lead', 'developer', 'employee'])(
    'refuses a %s — only owner/admin/hr may change a role',
    (role) => {
      expect(allow(actor(role), member('developer'), 'employee')).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  );

  it('refuses a client by role', () => {
    expect(allow(actor('client'), member('developer'), 'employee')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('refuses a client by user_type even if the role claim says otherwise', () => {
    expect(
      allow(actor('admin', { userType: 'client' }), member('developer'), 'employee')
    ).toMatchObject({ ok: false, status: 403 });
  });

  it.each(['owner', 'admin', 'hr'])('allows a %s to make a permitted change', (role) => {
    expect(allow(actor(role), member('developer'), 'employee')).toEqual({ ok: true });
  });
});

describe('authorizeRoleChange — nobody may change their own role', () => {
  it('refuses a self-change matched on (app_user_id, user_type)', () => {
    const me = actor('admin', { appUserId: 'me', userType: 'admin' });
    const myRow = member('admin', { user_id: 'me', user_type: 'admin', email: 'other@x.com' });
    expect(allow(me, myRow, 'owner')).toMatchObject({ ok: false, status: 403 });
    expect(allow(me, myRow, 'developer')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a self-change matched on email, for legacy accounts with no app_user_id', () => {
    const me = actor('admin', { appUserId: null, email: 'Me@Example.com' });
    const myRow = member('admin', { user_id: 'someone-else', email: 'me@example.com' });
    expect(allow(me, myRow, 'developer')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses an OWNER changing their own role too — the loop is closed for everyone', () => {
    const me = actor('owner', { appUserId: 'me', userType: 'admin' });
    expect(allow(me, member('owner', { user_id: 'me', user_type: 'admin' }), 'admin')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('does not confuse the same app id under a different user_type', () => {
    const me = actor('admin', { appUserId: 'shared-id', userType: 'admin', email: 'a@x.com' });
    const other = member('developer', {
      user_id: 'shared-id',
      user_type: 'developer',
      email: 'b@x.com',
    });
    expect(allow(me, other, 'employee')).toEqual({ ok: true });
  });
});

describe('authorizeRoleChange — the owner role', () => {
  it('refuses an admin granting owner', () => {
    expect(allow(actor('admin'), member('developer'), 'owner')).toMatchObject({
      ok: false,
      status: 403,
      error: expect.stringContaining('owner'),
    });
  });

  it('refuses hr granting owner', () => {
    expect(allow(actor('hr'), member('developer'), 'owner')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('refuses an admin REVOKING owner from someone else', () => {
    expect(allow(actor('admin'), member('owner'), 'developer')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('lets an owner grant owner', () => {
    expect(allow(actor('owner'), member('admin'), 'owner')).toEqual({ ok: true });
  });

  it('lets an owner revoke owner from another owner', () => {
    expect(allow(actor('owner'), member('owner'), 'admin')).toEqual({ ok: true });
  });
});

describe('authorizeRoleChange — rank rules for non-owner callers', () => {
  it('refuses hr promoting anyone to admin', () => {
    expect(allow(actor('hr'), member('developer'), 'admin')).toMatchObject({
      ok: false,
      status: 403,
      error: expect.stringContaining('admin'),
    });
  });

  it('refuses hr promoting anyone to hr — equal rank is not below', () => {
    expect(allow(actor('hr'), member('developer'), 'hr')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses hr DEMOTING an admin — otherwise people-ops can unseat the admins', () => {
    expect(allow(actor('hr'), member('admin'), 'developer')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('refuses an admin granting admin — a peer cannot be minted sideways', () => {
    expect(allow(actor('admin'), member('developer'), 'admin')).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('lets hr move someone between the roles below it', () => {
    expect(allow(actor('hr'), member('developer'), 'team_lead')).toEqual({ ok: true });
    expect(allow(actor('hr'), member('team_lead'), 'employee')).toEqual({ ok: true });
  });

  it('lets an admin promote a developer to manager', () => {
    expect(allow(actor('admin'), member('developer'), 'manager')).toEqual({ ok: true });
  });

  it('lets an owner grant admin', () => {
    expect(allow(actor('owner'), member('developer'), 'admin')).toEqual({ ok: true });
  });
});

describe('authorizeRoleChange — target and role validation', () => {
  it('rejects a role outside the 8', () => {
    expect(allow(actor('owner'), member('developer'), 'superuser')).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('rejects a missing role', () => {
    expect(allow(actor('owner'), member('developer'), null)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('reports a membership in another organization as not found, not as forbidden', () => {
    const foreign = member('developer', { organization_id: 'org-2' });
    expect(allow(actor('owner'), foreign, 'manager')).toMatchObject({ ok: false, status: 404 });
  });

  it('reports a missing membership as not found', () => {
    expect(allow(actor('owner'), null, 'manager')).toMatchObject({ ok: false, status: 404 });
  });

  it('checks the caller BEFORE the target, so a non-privileged caller learns nothing', () => {
    expect(allow(actor('developer'), null, 'manager')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('writeClaimFirst — the safe order', () => {
  it('writes the JWT claim first on a demotion, dropping the privilege first', () => {
    expect(writeClaimFirst('admin', 'developer')).toBe(true);
    expect(writeClaimFirst('owner', 'admin')).toBe(true);
  });

  it('writes the membership row first on a promotion, granting nothing early', () => {
    expect(writeClaimFirst('developer', 'hr')).toBe(false);
    expect(writeClaimFirst('employee', 'admin')).toBe(false);
  });

  it('treats a no-op re-stamp as a promotion order (nothing is being dropped)', () => {
    expect(writeClaimFirst('manager', 'manager')).toBe(false);
  });
});

describe('POST /api/admin/members/role', () => {
  it('401s without a verified token', async () => {
    getAuthedOrg.mockResolvedValue(null);
    const res = await POST({ json: async () => ({ membershipId: 'mem-1', role: 'manager' }) });
    expect(res.status).toBe(401);
  });

  it('400s without a membershipId', async () => {
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(makeSvc({ membership: member('developer') }).svc);
    const res = await POST({ json: async () => ({ role: 'manager' }) });
    expect(res.status).toBe(400);
  });

  it('refuses a self-role-change end to end', async () => {
    const me = actor('admin', { appUserId: 'me', userType: 'admin' });
    const { res, json, calls } = await post({
      auth: me,
      membership: member('admin', { user_id: 'me', user_type: 'admin' }),
      body: { membershipId: 'mem-1', role: 'owner' },
    });
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/your own role/i);
    expect(calls.order).toEqual([]);
  });

  it('refuses a non-owner granting owner end to end, writing nothing', async () => {
    const { res, json, calls } = await post({
      auth: actor('admin'),
      membership: member('developer'),
      body: { membershipId: 'mem-1', role: 'owner' },
    });
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/owner/i);
    expect(calls.order).toEqual([]);
    expect(calls.claimUpdates).toEqual([]);
  });

  it('refuses hr promoting to admin end to end, writing nothing', async () => {
    const { res, json, calls } = await post({
      auth: actor('hr'),
      membership: member('developer'),
      body: { membershipId: 'mem-1', role: 'admin' },
    });
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/admin/);
    expect(calls.order).toEqual([]);
    expect(calls.claimUpdates).toEqual([]);
  });

  it('takes the organization from the token and ignores one in the body', async () => {
    const { res } = await post({
      auth: actor('owner'),
      membership: member('developer', { organization_id: 'org-2' }),
      body: { membershipId: 'mem-1', role: 'manager', organizationId: 'org-2' },
    });
    expect(res.status).toBe(404);
  });

  it('writes both stores and returns the resulting role', async () => {
    const { res, json, calls } = await post({
      auth: actor('owner'),
      membership: member('developer'),
      body: { membershipId: 'mem-1', role: 'manager' },
    });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, role: 'manager', previousRole: 'developer', authUpdated: true });
    expect(calls.order).toEqual(['membership_row', 'auth_claim']);
    expect(calls.rowUpdates[0]).toMatchObject({ role: 'manager' });
  });

  it('PRESERVES the other claims when it updates app_metadata', async () => {
    const { calls } = await post({
      auth: actor('owner'),
      membership: member('developer'),
      claims: {
        organization_id: ORG,
        role: 'developer',
        user_type: 'developer',
        app_user_id: 'target-app-id',
        custom_flag: true,
      },
      body: { membershipId: 'mem-1', role: 'manager' },
    });
    expect(calls.claimUpdates).toHaveLength(1);
    expect(calls.claimUpdates[0].attrs.app_metadata).toEqual({
      organization_id: ORG,
      role: 'manager',
      user_type: 'developer',
      app_user_id: 'target-app-id',
      custom_flag: true,
    });
  });

  it('drops the JWT claim BEFORE the row on a demotion', async () => {
    const { res, calls } = await post({
      auth: actor('owner'),
      membership: member('admin', { user_type: 'admin' }),
      body: { membershipId: 'mem-1', role: 'developer' },
    });
    expect(res.status).toBe(200);
    expect(calls.order).toEqual(['auth_claim', 'membership_row']);
  });

  it('leaves the restrictive state when the second write fails on a demotion', async () => {
    const { res, json, calls } = await post({
      auth: actor('owner'),
      membership: member('admin', { user_type: 'admin' }),
      body: { membershipId: 'mem-1', role: 'developer' },
      fail: { row: true },
    });
    expect(res.status).toBe(500);
    expect(json).toMatchObject({ partial: true, applied: 'auth_claim', failed: 'membership_row' });
    // The claim (the only thing RLS reads) already holds the LOWER role.
    expect(calls.claimUpdates[0].attrs.app_metadata.role).toBe('developer');
    expect(calls.order).toEqual(['auth_claim', 'membership_row']);
  });

  it('leaves the restrictive state when the second write fails on a promotion', async () => {
    const { res, json, calls } = await post({
      auth: actor('owner'),
      membership: member('developer'),
      body: { membershipId: 'mem-1', role: 'manager' },
      fail: { claim: true },
    });
    expect(res.status).toBe(500);
    expect(json).toMatchObject({ partial: true, applied: 'membership_row', failed: 'auth_claim' });
    // The claim was NOT raised, so RLS still enforces the lower role.
    expect(calls.claimUpdates).toEqual([]);
    expect(calls.order).toEqual(['membership_row', 'auth_claim']);
  });

  it('changes nothing when the FIRST write fails', async () => {
    const { res, calls } = await post({
      auth: actor('owner'),
      membership: member('admin', { user_type: 'admin' }),
      body: { membershipId: 'mem-1', role: 'developer' },
      fail: { claim: true },
    });
    expect(res.status).toBe(502);
    expect(calls.rowUpdates).toEqual([]);
  });

  it('reports authUpdated:false when the member has no linked auth account', async () => {
    const { res, json, calls } = await post({
      auth: actor('owner'),
      membership: member('developer'),
      profile: { id: 'target-app-id', organization_id: ORG, auth_user_id: null },
      body: { membershipId: 'mem-1', role: 'manager' },
    });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, role: 'manager', authUpdated: false });
    expect(json.warning).toMatch(/no linked auth account/i);
    expect(calls.order).toEqual(['membership_row']);
  });

  it('ignores an auth_user_id from a profile row in another organization', async () => {
    const { json, calls } = await post({
      auth: actor('owner'),
      membership: member('developer'),
      profile: { id: 'target-app-id', organization_id: 'org-2', auth_user_id: 'auth-target' },
      body: { membershipId: 'mem-1', role: 'manager' },
    });
    expect(json.authUpdated).toBe(false);
    expect(calls.claimUpdates).toEqual([]);
  });
});
