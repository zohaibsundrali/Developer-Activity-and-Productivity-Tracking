import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The admin Account screen, and the half of it that lives on the server.
 *
 * THE GAP THESE TESTS CLOSE
 *  POST /api/developer/change-password looked its caller up in `developers`
 *  unconditionally. An admin holds a perfectly valid token whose app_user_id
 *  points at a row in `admin_users`, so that lookup found nothing and every
 *  admin got "Developer not found." — there was no way for an admin to change
 *  their own password anywhere in the product. The route now picks the table
 *  from the caller's verified `user_type` claim.
 *
 *  What must stay true:
 *   1. An admin caller reaches the credential change and it targets THEIR auth
 *      user.
 *   2. The developer path is untouched: same table, same event, same result.
 *   3. A wrong current password is still refused for an admin, and nothing is
 *      written.
 *   4. The table comes from the token, never from the request body.
 *
 *  Plus the client-side rule the form must enforce before it sends anything: a
 *  confirmation that does not match blocks the submit.
 */

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock('@/utils/systemEvents', () => ({
  recordEvent: vi.fn(async () => true),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const { getAuthedOrg, serviceClient } = await import('@/utils/serverAuth');
const { recordEvent } = await import('@/utils/systemEvents');
const { createClient } = await import('@supabase/supabase-js');
const { POST } = await import('@/app/api/developer/change-password/route');
const { validatePasswordChange, passwordStrength, MIN_PASSWORD_LENGTH } = await import(
  '@/components/admin/AdminAccount'
);

const ORG = 'org-1';
const ADMIN_ID = 'admin-app-id';
const DEV_ID = 'dev-app-id';
const AUTH_ID = 'auth-user-id';
const EMAIL = 'owner@example.com';
const CURRENT = 'current-password';
const NEXT = 'a-brand-new-password';

/** A verified admin caller, as getAuthedOrg() returns them. */
function adminCaller(overrides = {}) {
  return {
    token: 't',
    userId: AUTH_ID,
    email: EMAIL,
    orgId: ORG,
    role: 'owner',
    userType: 'admin',
    appUserId: ADMIN_ID,
    ...overrides,
  };
}

function developerCaller(overrides = {}) {
  return {
    token: 't',
    userId: AUTH_ID,
    email: EMAIL,
    orgId: ORG,
    role: 'developer',
    userType: 'developer',
    appUserId: DEV_ID,
    ...overrides,
  };
}

function req(body) {
  return { json: async () => body };
}

function validBody(overrides = {}) {
  return {
    currentPassword: CURRENT,
    newPassword: NEXT,
    confirmNewPassword: NEXT,
    ...overrides,
  };
}

/**
 * Service-role stand-in. Records which tables were read and every write, so a
 * test can assert both that the right table was chosen and that a refusal wrote
 * nothing at all.
 */
function makeSvc({
  row = { id: ADMIN_ID, email: EMAIL, auth_user_id: AUTH_ID },
  rowsByTable = null,
  authUser = { id: AUTH_ID, email: EMAIL },
  updateUserError = null,
} = {}) {
  const writes = [];
  const tables = [];

  const chain = (result) => {
    const c = {
      eq: () => c,
      maybeSingle: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return c;
  };

  const svc = {
    writes,
    tables,
    from: vi.fn((table) => {
      tables.push(table);
      const data = rowsByTable ? rowsByTable[table] ?? null : row;
      return {
        select: () => chain({ data, error: null }),
        update: (values) => {
          writes.push({ table, values });
          return chain({ data: null, error: null });
        },
      };
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: authUser }, error: null })),
        updateUserById: vi.fn(async () => ({ data: { user: authUser }, error: updateUserError })),
      },
    },
  };
  return svc;
}

/** The throwaway anon client the route uses to verify the CURRENT password. */
function makeVerifier({ user = { id: AUTH_ID }, error = null } = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: user ? { user, session: { access_token: 'x' } } : { user: null },
        error,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
}

function install(svc, verifier) {
  serviceClient.mockReturnValue(svc);
  createClient.mockReturnValue(verifier);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthedOrg.mockResolvedValue(adminCaller());
});

// ── 1. An admin can change their own password ─────────────────────────────
describe('an admin caller', () => {
  it('is resolved in admin_users and reaches the credential change', async () => {
    const svc = makeSvc();
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The profile row was looked up in admin_users, not developers.
    expect(svc.tables).toContain('admin_users');
    expect(svc.tables).not.toContain('developers');
    // And the change landed on the caller's own Supabase Auth user.
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { password: NEXT });
    // Still no profile-table write of any kind.
    expect(svc.writes).toHaveLength(0);
  });

  it('records the change against the admin, not as a developer', async () => {
    install(makeSvc(), makeVerifier());

    await POST(req(validBody()));

    const changed = recordEvent.mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg.type === 'auth.password_changed');
    expect(changed).toBeTruthy();
    expect(changed.context.userType).toBe('admin');
    expect(changed.context.userId).toBe(ADMIN_ID);
  });

  it('still verifies the current password against Supabase Auth', async () => {
    const svc = makeSvc();
    const verifier = makeVerifier();
    install(svc, verifier);

    await POST(req(validBody()));

    expect(verifier.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: CURRENT,
    });
    expect(verifier.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('refuses a wrong current password and writes nothing', async () => {
    const svc = makeSvc();
    install(
      svc,
      makeVerifier({
        user: null,
        error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
      })
    );

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Current password is incorrect.');
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(svc.writes).toHaveLength(0);
  });

  it('keeps the distinct 429 for a rate-limited verification', async () => {
    const svc = makeSvc();
    install(
      svc,
      makeVerifier({
        user: null,
        error: { code: 'over_request_rate_limit', status: 429, message: 'rate limit exceeded' },
      })
    );

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.code).toBe('rate_limited');
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('tells an unlinked admin the truth instead of succeeding', async () => {
    const svc = makeSvc({
      row: { id: ADMIN_ID, email: EMAIL, auth_user_id: null },
      authUser: null,
    });
    const verifier = makeVerifier();
    install(svc, verifier);

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('legacy_only_account');
    expect(svc.writes).toHaveLength(0);
    expect(verifier.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('takes the table from the token, not from the body', async () => {
    // A body that names another account or another kind of user must not
    // redirect the change. The only inputs are the token's claims.
    const svc = makeSvc();
    install(svc, makeVerifier());

    await POST(req(validBody({ userType: 'developer', developerId: 'victim-id' })));

    expect(svc.tables).toContain('admin_users');
    expect(svc.tables).not.toContain('developers');
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { password: NEXT });
  });
});

// ── 2. The developer path is unchanged ────────────────────────────────────
describe('the developer path', () => {
  beforeEach(() => {
    getAuthedOrg.mockResolvedValue(developerCaller());
  });

  it('still resolves in developers and updates the auth credential', async () => {
    const svc = makeSvc({ row: { id: DEV_ID, email: EMAIL, auth_user_id: AUTH_ID } });
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(svc.tables).toContain('developers');
    expect(svc.tables).not.toContain('admin_users');
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { password: NEXT });
    expect(svc.writes).toHaveLength(0);
  });

  it('still records the event as a developer', async () => {
    install(makeSvc({ row: { id: DEV_ID, email: EMAIL, auth_user_id: AUTH_ID } }), makeVerifier());

    await POST(req(validBody()));

    const changed = recordEvent.mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg.type === 'auth.password_changed');
    expect(changed.message).toBe('A developer changed their own password.');
    expect(changed.context.userType).toBe('developer');
    expect(changed.context.userId).toBe(DEV_ID);
  });

  it('still says "Developer not found." when the row is missing', async () => {
    const svc = makeSvc({ rowsByTable: { developers: null } });
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Developer not found.');
  });

  it('leaves a non-admin, non-developer caller resolving to developers, as before', async () => {
    // A client has always landed on the developers lookup and been turned away
    // by it. Adding the admin branch must not open a new door for them.
    getAuthedOrg.mockResolvedValue(
      developerCaller({ userType: 'client', role: 'client', appUserId: 'client-id' })
    );
    const svc = makeSvc({ rowsByTable: { developers: null } });
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));

    expect(svc.tables).toEqual(['developers']);
    expect(res.status).toBe(404);
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

// ── 3. The form blocks a mismatched confirmation client-side ──────────────
describe('the account form validation', () => {
  it('blocks a confirmation that does not match the new password', () => {
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmNewPassword: 'not-the-same',
    });

    expect(errors.confirmNewPassword).toMatch(/does not match/i);
    // Nothing may be submitted while any error stands.
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  it('passes a matching confirmation', () => {
    expect(
      validatePasswordChange({
        currentPassword: CURRENT,
        newPassword: NEXT,
        confirmNewPassword: NEXT,
      })
    ).toEqual({});
  });

  it('requires all three fields', () => {
    const errors = validatePasswordChange({});
    expect(errors.currentPassword).toBeTruthy();
    expect(errors.newPassword).toBeTruthy();
    expect(errors.confirmNewPassword).toBeTruthy();
  });

  it('refuses a new password identical to the current one', () => {
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: CURRENT,
      confirmNewPassword: CURRENT,
    });
    expect(errors.newPassword).toMatch(/different/i);
  });

  it('enforces the same minimum length the route does', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: short,
      confirmNewPassword: short,
    });
    expect(errors.newPassword).toMatch(new RegExp(`${MIN_PASSWORD_LENGTH} characters`));
  });

  it('reports strength as a word, so the meter is never colour alone', () => {
    expect(passwordStrength('short').label).toBe('Too short');
    expect(passwordStrength('Abcdefg1!').label).toBe('Strong');
    expect(passwordStrength('abcdefghij').score).toBeGreaterThan(0);
  });
});
