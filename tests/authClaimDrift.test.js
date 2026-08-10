import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * JWT claim drift — the audit, the self-repair path, and the detection.
 *
 * RLS reads the caller's organization, identity and role from
 * auth.users.raw_app_meta_data (auth_org / auth_app_user_id / auth_user_type /
 * auth_role, migration 018). The application reads the same four facts from
 * `memberships`. Nothing kept them in step, so they drifted — and every symptom
 * pointed away from the cause: 401 "Unauthorized" from admin routes when
 * app_user_id is stale, "new row violates row-level security policy" when
 * organization_id is. database/052_repair_auth_claims.sql repaired it by hand.
 *
 * These tests pin the mechanism that replaces the hand repair:
 *   1. /api/admin/members/sync-roles audits and repairs all FOUR claims, read
 *      only unless explicitly told to apply, and skips — never guesses —
 *      ambiguous, inactive, unlinked and orphaned rows,
 *   2. /api/auth/repair-claims lets the one person who cannot reach an admin
 *      route (because their own claims are what is broken) repair themselves,
 *      from their verified identity, with no way to name a target,
 *   3. getAuthedOrg records the drift where it is detected instead of leaving
 *      it invisible until someone reports a broken screen.
 */

const hoisted = vi.hoisted(() => ({ client: null }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => hoisted.client,
}));

vi.mock('@/utils/systemEvents', () => ({
  recordEvent: vi.fn(async () => true),
}));

// The routes need the REAL getBearerToken (the self-repair route authenticates
// on the header itself) but a fake service client and, for the admin route, a
// fake getAuthedOrg.
vi.mock('@/utils/serverAuth', async () => {
  const actual = await vi.importActual('@/utils/serverAuth');
  return { ...actual, getAuthedOrg: vi.fn(), serviceClient: vi.fn() };
});

const { getAuthedOrg, serviceClient } = await import('@/utils/serverAuth');
const { recordEvent } = await import('@/utils/systemEvents');
const realServerAuth = await vi.importActual('@/utils/serverAuth');
const repair = await import('@/app/api/auth/repair-claims/route');
const audit = await import('@/app/api/admin/members/sync-roles/route');

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

// ── An in-memory Supabase stand-in ────────────────────────────────────────
// Enough of the query builder for both routes: select/eq/in/maybeSingle over
// three tables, plus the auth admin calls. Every write is recorded, because
// "what exactly was written, and for whom" is the thing under test.
function likeMatch(value, pattern) {
  if (value === null || value === undefined) return false;
  const rx = new RegExp(
    `^${String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/[%*]/g, '.*')
      .replace(/_/g, '.')}$`,
    'i'
  );
  return rx.test(String(value));
}

function makeDb({ memberships = [], adminUsers = [], developers = [], authUsers = [], failUpdate = false } = {}) {
  const tables = { memberships, admin_users: adminUsers, developers };
  const updates = [];

  const builder = (table) => {
    const filters = [];
    const rows = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (col, val) => {
        filters.push((r) => String(r[col] ?? '') === String(val));
        return b;
      },
      in: (col, vals) => {
        const set = new Set((vals || []).map((v) => String(v)));
        filters.push((r) => set.has(String(r[col] ?? '')));
        return b;
      },
      // Postgres ILIKE: case-insensitive, with % and * as wildcards.
      ilike: (col, pattern) => {
        filters.push((r) => likeMatch(r[col], pattern));
        return b;
      },
      // PostgREST's `or`: "col.ilike.*a*,col.ilike.*b*".
      or: (expr) => {
        const clauses = String(expr)
          .split(',')
          .map((c) => c.split('.'))
          .filter((parts) => parts.length >= 3 && parts[1] === 'ilike')
          .map(([col, , ...rest]) => [col, rest.join('.')]);
        filters.push((r) => clauses.some(([col, pattern]) => likeMatch(r[col], pattern)));
        return b;
      },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return b;
  };

  const findUser = (id) => authUsers.find((u) => u.id === id) || null;

  const svc = {
    from: (table) => builder(table),
    auth: {
      // Verifying the caller's own bearer token. Tokens look like "tok:<id>".
      getUser: async (token) => {
        const id = String(token || '').startsWith('tok:') ? String(token).slice(4) : null;
        const user = id ? findUser(id) : null;
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { name: 'invalid_token', status: 401 } };
      },
      admin: {
        getUserById: async (id) => {
          const user = findUser(id);
          return user ? { data: { user }, error: null } : { data: null, error: { message: 'not found' } };
        },
        updateUserById: async (id, attrs) => {
          if (failUpdate) return { error: { message: 'update failed' } };
          updates.push({ id, attrs });
          const user = findUser(id);
          if (user) user.app_metadata = attrs.app_metadata;
          return { error: null };
        },
      },
    },
  };

  return { svc, updates, tables, authUsers };
}

/** A request carrying a bearer token, and a body that must never be read. */
function req(token, body = undefined) {
  return {
    headers: { get: (name) => (String(name).toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null) },
    json: vi.fn(async () => body || {}),
  };
}

function membership(over = {}) {
  return {
    id: 'mem-1',
    organization_id: ORG,
    user_id: 'app-1',
    user_type: 'developer',
    email: 'me@example.com',
    role: 'developer',
    status: 'active',
    ...over,
  };
}

function authUser(over = {}) {
  return {
    id: 'auth-1',
    email: 'me@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', organization_id: ORG, app_user_id: 'app-1', user_type: 'developer', role: 'developer' },
    ...over,
  };
}

/** A verified admin caller, as getAuthedOrg() returns them. */
function actor(role = 'owner', over = {}) {
  return {
    token: 't',
    userId: 'auth-actor',
    email: 'actor@example.com',
    orgId: ORG,
    role,
    userType: 'admin',
    appUserId: 'actor-app-id',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.client = null;
});

// ══════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/repair-claims — the way out of the chicken-and-egg', () => {
  it('refuses a request with no bearer token', async () => {
    serviceClient.mockReturnValue(makeDb().svc);
    const res = await repair.POST(req(null));
    expect(res.status).toBe(401);
  });

  it('refuses a token Supabase will not verify — the signature is the one thing it trusts', async () => {
    const db = makeDb({ authUsers: [authUser()] });
    serviceClient.mockReturnValue(db.svc);
    const res = await repair.POST(req('tok:nobody'));
    expect(res.status).toBe(401);
    expect(db.updates).toEqual([]);
  });

  it('repairs the caller’s own claims from their single active membership', async () => {
    // The drift: the claims name another org AND another app user — the exact
    // live shape 052 was written for.
    const db = makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1', organization_id: ORG }],
      authUsers: [
        authUser({
          app_metadata: { provider: 'email', organization_id: OTHER_ORG, app_user_id: 'stale-app-id', user_type: 'admin', role: 'admin' },
        }),
      ],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ repaired: true, organizationId: ORG, userId: 'app-1', userType: 'developer', role: 'developer' });
    expect(json.fields.sort()).toEqual(['app_user_id', 'organization_id', 'role', 'user_type']);
    expect(db.updates).toHaveLength(1);
    // Their OWN auth account, and only theirs.
    expect(db.updates[0].id).toBe('auth-1');
    expect(db.updates[0].attrs.app_metadata).toEqual({
      provider: 'email', // merged, not replaced
      organization_id: ORG,
      app_user_id: 'app-1',
      user_type: 'developer',
      role: 'developer',
    });
  });

  it('writes nothing for anybody else, even when other broken accounts exist', async () => {
    const db = makeDb({
      memberships: [membership(), membership({ id: 'mem-2', user_id: 'app-2', email: 'other@example.com', role: 'owner' })],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }, { id: 'app-2', auth_user_id: 'auth-2' }],
      authUsers: [
        authUser({ app_metadata: { organization_id: OTHER_ORG } }),
        authUser({ id: 'auth-2', email: 'other@example.com', app_metadata: { organization_id: OTHER_ORG } }),
      ],
    });
    serviceClient.mockReturnValue(db.svc);

    await repair.POST(req('tok:auth-1'));
    expect(db.updates.map((u) => u.id)).toEqual(['auth-1']);
  });

  it('IGNORES a body naming another user, another organization and a better role', async () => {
    const build = () =>
      makeDb({
        memberships: [membership(), membership({ id: 'mem-2', organization_id: OTHER_ORG, user_id: 'app-9', email: 'boss@example.com', role: 'owner' })],
        developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
        authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
      });

    const plain = build();
    serviceClient.mockReturnValue(plain.svc);
    const plainJson = await (await repair.POST(req('tok:auth-1'))).json();

    const attacked = build();
    serviceClient.mockReturnValue(attacked.svc);
    const request = req('tok:auth-1', {
      organizationId: OTHER_ORG,
      organization_id: OTHER_ORG,
      appUserId: 'app-9',
      app_user_id: 'app-9',
      userId: 'app-9',
      membershipId: 'mem-2',
      email: 'boss@example.com',
      userType: 'admin',
      role: 'owner',
    });
    const attackedJson = await (await repair.POST(request)).json();

    // Byte-identical outcome: the body cannot reach any decision…
    expect(attackedJson).toEqual(plainJson);
    expect(attacked.updates[0].attrs.app_metadata).toEqual(plain.updates[0].attrs.app_metadata);
    expect(attacked.updates[0].attrs.app_metadata.organization_id).toBe(ORG);
    expect(attacked.updates[0].attrs.app_metadata.role).toBe('developer');
    // …because it is never read at all.
    expect(request.json).not.toHaveBeenCalled();
  });

  it('REFUSES an ambiguous identity — two active memberships are never guessed between', async () => {
    const db = makeDb({
      memberships: [membership(), membership({ id: 'mem-2', organization_id: OTHER_ORG, user_id: 'app-7', email: 'ME@example.com ', role: 'owner' })],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({ code: 'ambiguous', repairable: false, activeMemberships: 2 });
    expect(db.updates).toEqual([]);
    // The refusal never names the other tenant.
    expect(JSON.stringify(json)).not.toContain(OTHER_ORG);
  });

  it('REFUSES an orphan — no active membership means there is no organization to point at', async () => {
    const db = makeDb({ memberships: [], authUsers: [authUser({ app_metadata: { organization_id: 'org-gone' } })] });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toMatchObject({ code: 'no_active_membership', repairable: false, activeMemberships: 0 });
    expect(db.updates).toEqual([]);
  });

  it('does not treat a suspended membership as a way back in', async () => {
    const db = makeDb({
      memberships: [membership({ status: 'suspended' })],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: {} })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    expect(res.status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it('does not treat an invited (not yet active) membership as active', async () => {
    const db = makeDb({ memberships: [membership({ status: 'invited' })], authUsers: [authUser({ app_metadata: {} })] });
    serviceClient.mockReturnValue(db.svc);
    expect((await repair.POST(req('tok:auth-1'))).status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it('will not match a membership by an UNCONFIRMED address', async () => {
    // Otherwise an unverified self-signup on somebody else's address would be a
    // way into their organization.
    const db = makeDb({
      memberships: [membership()],
      authUsers: [authUser({ email_confirmed_at: null, confirmed_at: null, app_metadata: {} })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    expect(res.status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it('still resolves an unlinked profile row by confirmed address alone (052’s rule)', async () => {
    const db = makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: null }],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    expect(res.status).toBe(200);
    expect(db.updates[0].attrs.app_metadata.organization_id).toBe(ORG);
  });

  it('resolves by the profile link even when the membership carries no address', async () => {
    const db = makeDb({
      memberships: [membership({ email: null })],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    expect(res.status).toBe(200);
    expect(db.updates[0].attrs.app_metadata.app_user_id).toBe('app-1');
  });

  it('treats a profile link and an address that disagree as ambiguous', async () => {
    const db = makeDb({
      memberships: [
        membership({ id: 'mem-link', email: null }),
        membership({ id: 'mem-email', organization_id: OTHER_ORG, user_id: 'app-5' }),
      ],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: {} })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    expect(res.status).toBe(409);
    expect(db.updates).toEqual([]);
  });

  it('is a no-op when the claims are already right', async () => {
    const db = makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser()],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ repaired: false, applied: false, verdict: 'ok' });
    expect(db.updates).toEqual([]);
  });

  it('records the repair against the organization it resolved', async () => {
    const db = makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
    });
    serviceClient.mockReturnValue(db.svc);

    await repair.POST(req('tok:auth-1'));
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, type: 'auth.self_claims_repaired', source: 'auth' })
    );
  });

  it('reports a refusal to System Health without attributing it to an organization', async () => {
    const db = makeDb({ memberships: [], authUsers: [authUser({ app_metadata: {} })] });
    serviceClient.mockReturnValue(db.svc);

    await repair.POST(req('tok:auth-1'));
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: null,
        type: 'auth.self_repair_refused',
        context: expect.objectContaining({ reason: 'no_active_membership' }),
      })
    );
  });

  it('does not claim success when the write fails', async () => {
    const db = makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
      failUpdate: true,
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.POST(req('tok:auth-1'));
    expect(res.status).toBe(502);
  });
});

describe('GET /api/auth/repair-claims — read-only diagnosis', () => {
  it('reports the drift without writing anything', async () => {
    const db = makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1' }],
      authUsers: [authUser({ app_metadata: { organization_id: OTHER_ORG, app_user_id: 'app-1', user_type: 'developer', role: 'developer' } })],
    });
    serviceClient.mockReturnValue(db.svc);

    const res = await repair.GET(req('tok:auth-1'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ applied: false, repairable: true, verdict: 'will_repair', fields: ['organization_id'] });
    expect(db.updates).toEqual([]);
  });

  it('refuses the ambiguous case here too', async () => {
    const db = makeDb({
      memberships: [membership(), membership({ id: 'mem-2', organization_id: OTHER_ORG, user_id: 'app-7' })],
      authUsers: [authUser({ app_metadata: {} })],
    });
    serviceClient.mockReturnValue(db.svc);
    expect((await repair.GET(req('tok:auth-1'))).status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('/api/admin/members/sync-roles — the full claims audit', () => {
  const auditDb = (over = {}) =>
    makeDb({
      memberships: [membership()],
      developers: [{ id: 'app-1', auth_user_id: 'auth-1', organization_id: ORG }],
      adminUsers: [],
      authUsers: [authUser()],
      ...over,
    });

  it('keeps the 401 / 403 contract', async () => {
    getAuthedOrg.mockResolvedValue(null);
    expect((await audit.GET(req('t'))).status).toBe(401);

    getAuthedOrg.mockResolvedValue(actor('manager'));
    serviceClient.mockReturnValue(auditDb().svc);
    expect((await audit.GET(req('t'))).status).toBe(403);

    getAuthedOrg.mockResolvedValue(actor('admin', { userType: 'client' }));
    expect((await audit.GET(req('t'))).status).toBe(403);
  });

  it('reports all four claims, not just role', async () => {
    const db = auditDb({
      authUsers: [
        authUser({
          app_metadata: { organization_id: OTHER_ORG, app_user_id: 'stale', user_type: 'admin', role: 'owner' },
        }),
      ],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.GET(req('t'))).json();
    expect(json.mismatched).toBe(1);
    expect(json.drift).toEqual({ organization_id: 1, app_user_id: 1, user_type: 1, role: 1 });
    expect(json.mismatches[0]).toMatchObject({
      claimOrgId: OTHER_ORG,
      claimAppUserId: 'stale',
      claimUserType: 'admin',
      claimRole: 'owner',
      membershipRole: 'developer',
      direction: 'escalated',
    });
    expect(json.mismatches[0].fields.sort()).toEqual(['app_user_id', 'organization_id', 'role', 'user_type']);
  });

  it('does not write on GET', async () => {
    const db = auditDb({ authUsers: [authUser({ app_metadata: { organization_id: OTHER_ORG } })] });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.GET(req('t'))).json();
    expect(json.applied).toBe(false);
    expect(db.updates).toEqual([]);
  });

  it('does not write on POST unless { apply: true } is asked for', async () => {
    const db = auditDb({ authUsers: [authUser({ app_metadata: { organization_id: OTHER_ORG } })] });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    for (const body of [{}, { apply: false }, { apply: 'true' }]) {
      const json = await (await audit.POST(req('t', body))).json();
      expect(json.applied).toBe(false);
      expect(db.updates).toEqual([]);
    }
  });

  it('repairs all four claims on { apply: true }, merging the rest', async () => {
    const db = auditDb({
      authUsers: [
        authUser({
          app_metadata: { provider: 'email', organization_id: OTHER_ORG, app_user_id: 'stale', user_type: 'admin', role: 'owner', flag: 1 },
        }),
      ],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.POST(req('t', { apply: true }))).json();
    expect(json).toMatchObject({ success: true, applied: true, repaired: 1 });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].attrs.app_metadata).toEqual({
      provider: 'email',
      flag: 1,
      organization_id: ORG,
      app_user_id: 'app-1',
      user_type: 'developer',
      role: 'developer',
    });
  });

  it('lists an identity with two active memberships as ambiguous and leaves it alone', async () => {
    const db = auditDb({
      memberships: [membership(), membership({ id: 'mem-2', organization_id: OTHER_ORG, user_id: 'app-9', email: 'me@example.com' })],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.POST(req('t', { apply: true }))).json();
    expect(json.ambiguous).toHaveLength(1);
    expect(json.ambiguous[0]).toMatchObject({ membershipId: 'mem-1', activeMemberships: 2 });
    expect(json.mismatched).toBe(0);
    expect(json.repaired).toBe(0);
    expect(db.updates).toEqual([]);
  });

  it('spots the competing membership even when it is stored with different casing', async () => {
    // Missing it would turn an ambiguous identity into an apparently
    // unambiguous one, and the audit would pull somebody out of the other
    // tenant it never looked at.
    const db = auditDb({
      memberships: [membership(), membership({ id: 'mem-2', organization_id: OTHER_ORG, user_id: 'app-9', email: '  ME@Example.com ' })],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale' } })],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.POST(req('t', { apply: true }))).json();
    expect(json.ambiguous).toHaveLength(1);
    expect(json.repaired).toBe(0);
    expect(db.updates).toEqual([]);
  });

  it('does not count a membership in another org that is NOT active as ambiguity', async () => {
    const db = auditDb({
      memberships: [membership(), membership({ id: 'mem-2', organization_id: OTHER_ORG, user_id: 'app-9', status: 'suspended' })],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale', app_user_id: 'app-1', user_type: 'developer', role: 'developer' } })],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.POST(req('t', { apply: true }))).json();
    expect(json.ambiguous).toEqual([]);
    expect(json.repaired).toBe(1);
    expect(db.updates[0].attrs.app_metadata.organization_id).toBe(ORG);
  });

  it('never re-stamps the claims of a suspended member', async () => {
    const db = auditDb({
      memberships: [membership({ status: 'suspended' })],
      authUsers: [authUser({ app_metadata: { organization_id: 'org-stale', role: 'developer' } })],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.POST(req('t', { apply: true }))).json();
    expect(json.inactive).toHaveLength(1);
    expect(json.repaired).toBe(0);
    expect(db.updates).toEqual([]);
  });

  it('lists unlinked and orphaned rows instead of guessing at them', async () => {
    const db = auditDb({
      memberships: [
        membership({ id: 'mem-unlinked', user_id: 'app-none', email: 'a@example.com' }),
        membership({ id: 'mem-orphan', user_id: 'app-gone', email: 'b@example.com' }),
      ],
      developers: [
        { id: 'app-none', auth_user_id: null, organization_id: ORG },
        { id: 'app-gone', auth_user_id: 'auth-deleted', organization_id: ORG },
      ],
      authUsers: [],
    });
    getAuthedOrg.mockResolvedValue(actor('owner'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.POST(req('t', { apply: true }))).json();
    expect(json.unlinked.map((r) => r.membershipId)).toEqual(['mem-unlinked']);
    expect(json.orphaned.map((r) => r.membershipId)).toEqual(['mem-orphan']);
    expect(json.repaired).toBe(0);
    expect(db.updates).toEqual([]);
  });

  it('reports a matching row as clean', async () => {
    const db = auditDb();
    getAuthedOrg.mockResolvedValue(actor('admin'));
    serviceClient.mockReturnValue(db.svc);

    const json = await (await audit.GET(req('t'))).json();
    expect(json).toMatchObject({ total: 1, matched: 1, mismatched: 0 });
    expect(json.drift).toEqual({ organization_id: 0, app_user_id: 0, user_type: 0, role: 0 });
  });
});

describe('sync-roles helpers', () => {
  it('counts only active memberships as active', () => {
    expect(audit.isActiveMembership('active')).toBe(true);
    expect(audit.isActiveMembership(' Active ')).toBe(true);
    expect(audit.isActiveMembership(null)).toBe(true); // legacy row, column is NOT NULL in practice
    expect(audit.isActiveMembership('invited')).toBe(false);
    expect(audit.isActiveMembership('suspended')).toBe(false);
  });

  it('compares the four claims by value, not by identity', () => {
    const m = membership();
    expect(audit.claimDrift(m, { organization_id: ORG, app_user_id: 'app-1', user_type: 'developer', role: 'developer' })).toEqual([]);
    expect(audit.claimDrift(m, {})).toEqual(['organization_id', 'app_user_id', 'user_type', 'role']);
    expect(audit.claimDrift(m, { organization_id: ORG, app_user_id: 'app-1', user_type: 'developer', role: 'admin' })).toEqual(['role']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('getAuthedOrg — drift is recorded where it is detected', () => {
  // The real getAuthedOrg, over the fake Supabase client. Each case uses a
  // distinct auth user id because the recorder de-duplicates per account.
  const authDb = (user, memberships = []) => makeDb({ authUsers: [user], memberships });

  it('records the missing-membership signature, and does NOT change what it returns', async () => {
    const user = authUser({
      id: 'drift-1',
      app_metadata: { organization_id: ORG, app_user_id: 'ghost', user_type: 'developer', role: 'developer' },
    });
    hoisted.client = authDb(user).svc;

    const auth = await realServerAuth.getAuthedOrg(req('tok:drift-1'));

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        type: 'auth.claims_drift_detected',
        severity: 'warning',
        source: 'auth',
        context: expect.objectContaining({ reason: 'membership_not_found', userId: 'ghost' }),
      })
    );
    // Behaviour is unchanged: an absent membership row is still treated as
    // active, so legacy accounts keep working. Detection only.
    expect(auth).toMatchObject({ orgId: ORG, appUserId: 'ghost' });
  });

  it('records a verified token that carries no organization claim, and returns null', async () => {
    const user = authUser({ id: 'drift-2', app_metadata: { provider: 'email' } });
    hoisted.client = authDb(user).svc;

    const auth = await realServerAuth.getAuthedOrg(req('tok:drift-2'));
    expect(auth).toBeNull();
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: null,
        type: 'auth.claims_drift_detected',
        context: expect.objectContaining({ reason: 'missing_org_claim' }),
      })
    );
  });

  it('records nothing when the claims and the membership agree', async () => {
    const user = authUser({ id: 'drift-3', app_metadata: { organization_id: ORG, app_user_id: 'app-1', user_type: 'developer', role: 'developer' } });
    hoisted.client = authDb(user, [membership()]).svc;

    const auth = await realServerAuth.getAuthedOrg(req('tok:drift-3'));
    expect(auth).toMatchObject({ orgId: ORG });
    const types = recordEvent.mock.calls.map((c) => c[0].type);
    expect(types).not.toContain('auth.claims_drift_detected');
  });

  it('does not repeat itself for the same account inside the window', async () => {
    const user = authUser({ id: 'drift-4', app_metadata: { organization_id: ORG, app_user_id: 'ghost', user_type: 'developer' } });
    hoisted.client = authDb(user).svc;

    await realServerAuth.getAuthedOrg(req('tok:drift-4'));
    await realServerAuth.getAuthedOrg(req('tok:drift-4'));
    await realServerAuth.getAuthedOrg(req('tok:drift-4'));

    const drift = recordEvent.mock.calls.filter((c) => c[0].type === 'auth.claims_drift_detected');
    expect(drift).toHaveLength(1);
  });
});
