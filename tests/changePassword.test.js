import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/developer/change-password — the credential it actually changes.
 *
 * THE BUG THESE TESTS PIN DOWN
 *  The route used to read `developers.password` (a cleartext column), compare
 *  the submitted current password to it as a string, write the new password
 *  back into the same cleartext column, and return success. Supabase Auth was
 *  never touched — and Supabase Auth is what src/app/login/page.js signs in
 *  with. So "change your password" changed nothing anybody authenticates
 *  against: a developer whose password had leaked rotated it, saw a success
 *  message, and remained compromised.
 *
 *  Three things therefore have to stay true, and each has a test below:
 *   1. A wrong current password is refused, and nothing is written.
 *   2. A successful change updates the REAL credential via
 *      auth.admin.updateUserById — not just a row in a table.
 *   3. An account with no linked Supabase Auth user is told so, explicitly,
 *      rather than being given the same silent success as before.
 *
 *  Plus the one that keeps the fix from re-creating the exposure it fixes: the
 *  legacy column is re-synced as a HASH, never as the cleartext password.
 */

// Captured at module scope by the route, so it must be set before the import.
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
const { createClient } = await import('@supabase/supabase-js');
const { POST } = await import('@/app/api/developer/change-password/route');
const { verifyLegacyPassword, hashLegacyPassword, isLegacyHash } = await import(
  '@/app/api/developer/change-password/legacyPassword'
);

const ORG = 'org-1';
const DEV_ID = 'dev-app-id';
const AUTH_ID = 'auth-user-id';
const EMAIL = 'dev@example.com';
const CURRENT = 'current-password';
const NEXT = 'a-brand-new-password';

/** A verified caller, as getAuthedOrg() returns them. */
function caller(overrides = {}) {
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
 * A stand-in for the service-role client. Records every write so a test can
 * assert that a refused change wrote nothing at all.
 */
function makeSvc({
  developer = { id: DEV_ID, email: EMAIL, auth_user_id: AUTH_ID },
  fetchError = null,
  authUser = { id: AUTH_ID, email: EMAIL },
  updateUserError = null,
  legacyUpdateError = null,
} = {}) {
  const writes = [];

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
    from: vi.fn(() => ({
      select: () => chain({ data: developer, error: fetchError }),
      update: (values) => {
        writes.push(values);
        return chain({ data: null, error: legacyUpdateError });
      },
    })),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: authUser }, error: null })),
        updateUserById: vi.fn(async () => ({
          data: { user: authUser },
          error: updateUserError,
        })),
      },
    },
  };
  return svc;
}

/** A stand-in for the throwaway anon client used to verify the CURRENT password. */
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
  getAuthedOrg.mockResolvedValue(caller());
});

// ── 1. A wrong current password is refused ────────────────────────────────
describe('the current password must be right', () => {
  it('refuses a wrong current password and writes nothing', async () => {
    const svc = makeSvc();
    const verifier = makeVerifier({
      user: null,
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    });
    install(svc, verifier);

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Current password is incorrect.');

    // The credential was not touched, and neither was the legacy column.
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(svc.writes).toHaveLength(0);
  });

  it('checks the current password against Supabase Auth, not the legacy column', async () => {
    // The legacy column is not even selected any more: it can hold a stale
    // value written by the broken version of this route, so trusting it would
    // accept a password the user cannot log in with.
    const svc = makeSvc();
    const verifier = makeVerifier();
    install(svc, verifier);

    await POST(req(validBody()));

    expect(verifier.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: CURRENT,
    });
  });

  it('signs the verification session out LOCALLY, so the caller stays logged in', async () => {
    const svc = makeSvc();
    const verifier = makeVerifier();
    install(svc, verifier);

    await POST(req(validBody()));

    // A global sign-out would revoke every refresh token for this user and
    // knock them out of the browser session they are changing their password in.
    expect(verifier.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('does not report an unconfirmed email as a wrong password', async () => {
    const svc = makeSvc();
    const verifier = makeVerifier({
      user: null,
      error: { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' },
    });
    install(svc, verifier);

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('email_not_confirmed');
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

// ── 2. A successful change updates the REAL credential ────────────────────
describe('a successful change updates the authentication credential', () => {
  it('calls auth.admin.updateUserById with the new password', async () => {
    const svc = makeSvc();
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { password: NEXT });
  });

  it('re-syncs the legacy column as a hash, never as the cleartext password', async () => {
    const svc = makeSvc();
    install(svc, makeVerifier());

    await POST(req(validBody()));

    expect(svc.writes).toHaveLength(1);
    const written = svc.writes[0].password;

    // The whole point: any authenticated colleague can read this column.
    expect(written).not.toBe(NEXT);
    expect(written).not.toContain(NEXT);
    expect(isLegacyHash(written)).toBe(true);

    // ...and it is still a working credential for the login fallback.
    await expect(verifyLegacyPassword(NEXT, written)).resolves.toBe(true);
    await expect(verifyLegacyPassword(CURRENT, written)).resolves.toBe(false);
  });

  it('reports the auth failure rather than a success when the credential update fails', async () => {
    const svc = makeSvc({ updateUserError: { message: 'auth is down' } });
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    // Nothing was written to the legacy column either, so the account is intact.
    expect(svc.writes).toHaveLength(0);
  });

  it('still reports success when only the legacy sync fails, and says so', async () => {
    // The real credential HAS changed at that point. Reporting failure would be
    // false and would send the user back to their old password.
    const svc = makeSvc({ legacyUpdateError: { message: 'rls' } });
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.legacySynced).toBe(false);
  });
});

// ── 3. A legacy-only account is told the truth ────────────────────────────
describe('an account with no linked Supabase Auth user', () => {
  it('is refused explicitly instead of silently succeeding', async () => {
    const svc = makeSvc({
      developer: { id: DEV_ID, email: EMAIL, auth_user_id: null },
      authUser: null,
    });
    const verifier = makeVerifier();
    install(svc, verifier);

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe('legacy_only_account');
    expect(body.error).toMatch(/not linked to the authentication service/i);
    expect(body.error).toMatch(/nothing was changed/i);

    // The old route would have written the new password here and returned
    // { success: true }. Nothing at all may be written.
    expect(svc.writes).toHaveLength(0);
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(verifier.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('refuses a profile linked to a different auth user than the caller', async () => {
    const svc = makeSvc({
      developer: { id: DEV_ID, email: EMAIL, auth_user_id: 'somebody-elses-auth-id' },
    });
    const verifier = makeVerifier();
    install(svc, verifier);

    const res = await POST(req(validBody()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('auth_link_mismatch');
    expect(svc.writes).toHaveLength(0);
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

// ── Guards that were already there and must not regress ───────────────────
describe('input handling', () => {
  it('rejects an unauthenticated caller', async () => {
    getAuthedOrg.mockResolvedValue(null);
    const svc = makeSvc();
    install(svc, makeVerifier());

    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
    expect(svc.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation before touching anything', async () => {
    const svc = makeSvc();
    install(svc, makeVerifier());

    const res = await POST(req(validBody({ confirmNewPassword: 'something-else' })));
    expect(res.status).toBe(400);
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('ignores a developer id supplied in the body', async () => {
    // The target is always the verified caller. A body field must not redirect
    // the change at somebody else's account.
    const svc = makeSvc();
    install(svc, makeVerifier());

    await POST(req(validBody({ developerId: 'victim-id' })));

    expect(svc.auth.admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { password: NEXT });
  });
});

// ── The legacy hash format itself ─────────────────────────────────────────
describe('legacy password hashing', () => {
  it('verifies a password it hashed', async () => {
    const hash = await hashLegacyPassword('correct horse battery staple');
    expect(hash.startsWith('pbkdf2$sha256$210000$')).toBe(true);
    await expect(verifyLegacyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyLegacyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashLegacyPassword('same-password');
    const b = await hashLegacyPassword('same-password');
    expect(a).not.toBe(b);
    await expect(verifyLegacyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyLegacyPassword('same-password', b)).resolves.toBe(true);
  });

  it('still accepts an untouched cleartext row, so nobody is locked out', async () => {
    // This is the branch that keeps every row written by the five unchanged
    // writers working. It goes away in stage 6 of migration 041, not before.
    await expect(verifyLegacyPassword('hunter2', 'hunter2')).resolves.toBe(true);
    await expect(verifyLegacyPassword('hunter3', 'hunter2')).resolves.toBe(false);
  });

  it('returns false rather than throwing for absent or malformed stored values', async () => {
    for (const stored of [null, undefined, '', 'pbkdf2$', 'pbkdf2$sha256$210000$bad', 'pbkdf2$md5$1$c2FsdA==$aGFzaA==', 'pbkdf2$sha256$0$c2FsdA==$aGFzaA==']) {
      await expect(verifyLegacyPassword('anything', stored)).resolves.toBe(false);
    }
    await expect(verifyLegacyPassword('', 'hunter2')).resolves.toBe(false);
  });
});
