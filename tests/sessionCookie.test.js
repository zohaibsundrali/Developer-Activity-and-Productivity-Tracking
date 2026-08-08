import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '@/utils/sessionCookie';

/**
 * The signed session cookie is the ONLY thing standing between a forged
 * `document.cookie` and the admin console (audit finding C5). These tests lock
 * in the properties that matter: signatures are required, tampering is
 * rejected, and expiry is enforced.
 */

const SECRET = 'test-secret-value-for-hmac-signing';
const OTHER_SECRET = 'a-completely-different-secret-value';

let originalSecret;
let originalServiceKey;

beforeEach(() => {
  originalSecret = process.env.SESSION_COOKIE_SECRET;
  originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SESSION_COOKIE_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_COOKIE_SECRET;
  else process.env.SESSION_COOKIE_SECRET = originalSecret;

  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
});

describe('constants', () => {
  it('exposes the cookie name used by the middleware', () => {
    expect(SESSION_COOKIE).toBe('dt_session');
  });

  it('uses a 12 hour lifetime', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
  });
});

describe('signSession / verifySession round trip', () => {
  it('verifies a freshly signed session and returns its claims', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    expect(typeof value).toBe('string');

    const session = await verifySession(value);
    expect(session).toEqual({ userType: 'admin', role: 'owner', orgId: 'org-1' });
  });

  it('produces a two-part payload.signature value', async () => {
    const value = await signSession({ userType: 'developer', role: 'developer', orgId: 'org-2' });
    const parts = value.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('normalises missing claims to null rather than undefined', async () => {
    const value = await signSession({});
    const session = await verifySession(value);
    expect(session).toEqual({ userType: null, role: null, orgId: null });
  });

  it('is deterministic for the same payload and secret', async () => {
    const a = await signSession({ userType: 'client', role: 'client', orgId: 'org-3' });
    const [payloadA, sigA] = a.split('.');
    const b = await signSession({ userType: 'client', role: 'client', orgId: 'org-3' });
    const [payloadB, sigB] = b.split('.');
    // Signed within the same second, so the exp claim (and thus payload) matches.
    if (payloadA === payloadB) expect(sigA).toBe(sigB);
  });
});

describe('tamper rejection', () => {
  it('rejects a modified payload (privilege escalation attempt)', async () => {
    const value = await signSession({ userType: 'developer', role: 'developer', orgId: 'org-1' });
    const [payload, sig] = value.split('.');

    // Decode, escalate to admin/owner, re-encode — signature is left untouched.
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    decoded.t = 'admin';
    decoded.r = 'owner';
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    expect(await verifySession(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a modified signature of the same length', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    const [payload, sig] = value.split('.');

    // Flip one character, keeping the length identical so the constant-time
    // comparison — not the length short-circuit — has to do the rejecting.
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(flipped).toHaveLength(sig.length);
    expect(await verifySession(`${payload}.${flipped}`)).toBeNull();
  });

  it('rejects a truncated signature', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    const [payload, sig] = value.split('.');
    expect(await verifySession(`${payload}.${sig.slice(0, -4)}`)).toBeNull();
  });

  it('rejects an empty signature', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    const [payload] = value.split('.');
    expect(await verifySession(`${payload}.`)).toBeNull();
  });

  it('rejects a signature made with a different secret', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    process.env.SESSION_COOKIE_SECRET = OTHER_SECRET;
    expect(await verifySession(value)).toBeNull();
  });

  it('rejects a signature lifted from a different payload', async () => {
    const admin = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    const dev = await signSession({ userType: 'developer', role: 'developer', orgId: 'org-1' });
    const [adminPayload] = admin.split('.');
    const [, devSig] = dev.split('.');
    expect(await verifySession(`${adminPayload}.${devSig}`)).toBeNull();
  });

  it('rejects an unsigned value with no separator', async () => {
    expect(await verifySession('admin_auth=true')).toBeNull();
  });

  it('rejects a value whose payload is not valid base64/JSON', async () => {
    // Sign a garbage payload correctly so it survives the HMAC check but
    // still fails to parse as JSON.
    const { createHmac } = await import('node:crypto');
    const payload = 'not-json-at-all';
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(await verifySession(`${payload}.${sig}`)).toBeNull();
  });
});

describe('malformed and missing input', () => {
  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a leading dot only', '.abc'],
    ['a number', 12345],
    ['an object', { userType: 'admin' }],
  ])('rejects %s', async (_label, input) => {
    expect(await verifySession(input)).toBeNull();
  });
});

describe('expiry', () => {
  it('rejects a session past its exp claim', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    expect(await verifySession(value)).not.toBeNull();

    const realNow = Date.now;
    try {
      const future = realNow() + (SESSION_MAX_AGE_SECONDS + 60) * 1000;
      Date.now = () => future;
      expect(await verifySession(value)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('still accepts a session just before expiry', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    const realNow = Date.now;
    try {
      const nearly = realNow() + (SESSION_MAX_AGE_SECONDS - 60) * 1000;
      Date.now = () => nearly;
      expect(await verifySession(value)).not.toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});

describe('missing secret material', () => {
  it('refuses to sign when no secret is configured', async () => {
    delete process.env.SESSION_COOKIE_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' })).toBeNull();
  });

  it('refuses to verify when no secret is configured (fails closed)', async () => {
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    delete process.env.SESSION_COOKIE_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await verifySession(value)).toBeNull();
  });

  it('falls back to the service role key when no dedicated secret is set', async () => {
    delete process.env.SESSION_COOKIE_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-fallback-secret';
    const value = await signSession({ userType: 'admin', role: 'owner', orgId: 'org-1' });
    expect(value).not.toBeNull();
    expect(await verifySession(value)).toEqual({
      userType: 'admin',
      role: 'owner',
      orgId: 'org-1',
    });
  });
});
