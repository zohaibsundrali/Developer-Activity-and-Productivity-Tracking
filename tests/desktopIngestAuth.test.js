import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Staged authentication for the two desktop-tracker ingest endpoints
 * (audit finding C7). Both routes used to `return true` when
 * DESKTOP_INGEST_SECRET was unset, so in production — where it IS unset —
 * anyone who knew a developer's UUID could inject activity rows and
 * screenshots into that person's timeline. In a monitoring product that is
 * fabricated evidence about a real employee.
 *
 * The desktop agent is a separate program already installed on customer
 * machines, so the gate cannot simply be closed. These tests pin down the
 * staged rollout that closes it without an outage:
 *
 *   stage 1 "open"    (neither var set)  — today's behaviour, plus telemetry
 *   stage 2 "observe" (secret only)      — accepted AND recorded
 *   stage 3 "enforce" (secret + enforce) — 401 without a valid credential
 *   misconfigured     (enforce, no secret) — fails CLOSED, never back to open
 */

const DEV_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const SECRET = 'f0e1d2c3b4a596887766554433221100ffeeddccbbaa99887766554433221100';
const SAME_LENGTH_WRONG = SECRET.slice(0, -1) + 'f';
const SHORT_WRONG = 'nope';
// A REAL 1x1 PNG. This was Buffer.from('fake-png-bytes'), which is not a PNG
// and is not an image at all — upload-screenshot now checks the decoded bytes
// for the eight-byte PNG signature, because Buffer.from(_, 'base64') silently
// drops what it cannot decode and therefore never rejected anything. These
// tests are about the ingest AUTH stages, so the payload has to be valid for
// them to reach the code they are testing.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const NOT_A_PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64');

const { supabaseState, recordEventMock, timingSafeEqualSpy } = vi.hoisted(() => ({
  supabaseState: { client: null },
  recordEventMock: vi.fn(async () => true),
  // A faithful stand-in for crypto.timingSafeEqual: same contract (throws on
  // unequal lengths) so the routes cannot pass these tests by feeding it
  // ragged buffers, and every call is observable.
  timingSafeEqualSpy: vi.fn((a, b) => {
    if (a.length !== b.length) {
      throw new RangeError('Input buffers must have the same byte length');
    }
    return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => supabaseState.client),
}));

vi.mock('@/utils/systemEvents', () => ({
  recordEvent: recordEventMock,
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal();
  const real = actual.default || actual;
  const wrapped = { ...real, timingSafeEqual: timingSafeEqualSpy };
  return { ...actual, default: wrapped, timingSafeEqual: timingSafeEqualSpy };
});

/** Supabase double: a known developer, a working bucket, a working insert. */
function makeSupabase() {
  const inserts = [];
  const uploads = [];
  return {
    inserts,
    uploads,
    from: vi.fn((table) => {
      if (table === 'developers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: DEV_ID, organization_id: ORG_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        insert: vi.fn(async (rows) => {
          inserts.push({ table, rows });
          return { error: null };
        }),
      };
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async (path) => {
          uploads.push(path);
          return { error: null };
        }),
      })),
    },
  };
}

// Fresh module instances per test: the routes hold per-process state (the
// telemetry throttle) and read the module-load warning at import time.
const LOADERS = {
  'track-activity': () => import('@/app/api/track-activity/route'),
  'upload-screenshot': () => import('@/app/api/upload-screenshot/route'),
};

async function loadRoute(name) {
  vi.resetModules();
  return LOADERS[name]();
}

function bodyFor(name) {
  return name === 'track-activity'
    ? { developer_id: DEV_ID, activity_type: 'keyboard', activity_data: { keystrokes: 12 } }
    : { developer_id: DEV_ID, image_data: PNG_BASE64, context: 'unit test' };
}

function makeRequest(name, headers = {}, bodyOverride = null) {
  return new Request(`http://localhost/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ ...bodyFor(name), ...(bodyOverride || {}) }),
  });
}

/** POST once with a freshly loaded route module. */
async function post(name, headers = {}, bodyOverride = null) {
  const mod = await loadRoute(name);
  const response = await mod.POST(makeRequest(name, headers, bodyOverride));
  return { response, body: await response.json() };
}

const ROUTES = Object.keys(LOADERS);

let envSecret;
let envEnforce;
let warnSpy;

beforeEach(() => {
  envSecret = process.env.DESKTOP_INGEST_SECRET;
  envEnforce = process.env.DESKTOP_INGEST_ENFORCE;
  delete process.env.DESKTOP_INGEST_SECRET;
  delete process.env.DESKTOP_INGEST_ENFORCE;

  supabaseState.client = makeSupabase();
  recordEventMock.mockClear();
  recordEventMock.mockImplementation(async () => true);
  timingSafeEqualSpy.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  if (envSecret === undefined) delete process.env.DESKTOP_INGEST_SECRET;
  else process.env.DESKTOP_INGEST_SECRET = envSecret;
  if (envEnforce === undefined) delete process.env.DESKTOP_INGEST_ENFORCE;
  else process.env.DESKTOP_INGEST_ENFORCE = envEnforce;
  warnSpy.mockRestore();
});

/* ── Stage 1: no secret set — today's behaviour, no outage ───────────────── */

describe('stage "open": neither variable set', () => {
  for (const name of ROUTES) {
    it(`${name} still accepts an unauthenticated request (installed agents keep working)`, async () => {
      const { response, body } = await post(name);
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it(`${name} still accepts a request carrying a junk credential`, async () => {
      const { response } = await post(name, { 'x-ingest-secret': 'whatever' });
      expect(response.status).toBe(200);
    });

    if (name === 'upload-screenshot') {
      it('refuses a payload whose decoded bytes are not a PNG', async () => {
        // The open stage means this is reachable with no credential at all, and
        // Buffer.from(_, 'base64') never rejects anything — it drops what it
        // cannot decode. Without a check on the decoded bytes the private
        // monitoring bucket is a free, unmetered blob store: the `screenshots`
        // plan limit is enforced nowhere.
        const { response } = await post(name, {}, { image_data: NOT_A_PNG_BASE64 });
        expect(response.status).toBe(415);
      });

      it('refuses a payload too short to carry a PNG signature', async () => {
        // The signature is eight bytes. A buffer shorter than that cannot be
        // checked against it, and the length guard has to REFUSE rather than
        // fall through — mutation testing caught this: flipping that guard to
        // `return true` left every other assertion green, because the other
        // fixtures all decode to more than eight bytes.
        const twoBytes = Buffer.from('ab').toString('base64');
        const { response } = await post(name, {}, { image_data: twoBytes });
        expect(response.status).toBe(415);
      });
    }

    it(`${name} warns loudly at import time that the endpoint is open`, async () => {
      await loadRoute(name);
      const warnings = warnSpy.mock.calls.map((call) => call.join(' '));
      expect(warnings.some((w) => w.includes('DESKTOP_INGEST_SECRET is NOT set'))).toBe(true);
      expect(warnings.some((w) => w.includes('UNAUTHENTICATED'))).toBe(true);
    });

    it(`${name} records the unauthenticated request so it cannot stay quiet`, async () => {
      await post(name);
      expect(recordEventMock).toHaveBeenCalledTimes(1);
      const event = recordEventMock.mock.calls[0][0];
      expect(event.severity).toBe('warning');
      expect(event.source).toBe('api');
      expect(event.context.reason).toBe('no_secret_configured');
      expect(event.context.statusCode).toBe(200);
    });

    it(`${name} does not reach for a constant-time compare when nothing is configured`, async () => {
      await post(name);
      expect(timingSafeEqualSpy).not.toHaveBeenCalled();
    });
  }
});

/* ── Stage 2: secret set, enforcement off — observe ──────────────────────── */

describe('stage "observe": secret set, enforcement off', () => {
  beforeEach(() => {
    process.env.DESKTOP_INGEST_SECRET = SECRET;
  });

  for (const name of ROUTES) {
    it(`${name} still accepts a legacy unauthenticated request`, async () => {
      const { response, body } = await post(name);
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it(`${name} records that acceptance as a warning with a count`, async () => {
      await post(name);
      expect(recordEventMock).toHaveBeenCalledTimes(1);
      const event = recordEventMock.mock.calls[0][0];
      expect(event.type).toBe('api.ingest_unauthenticated_accepted');
      expect(event.severity).toBe('warning');
      expect(event.source).toBe('api');
      expect(event.orgId).toBeNull();
      expect(event.context.route).toBe(`/api/${name}`);
      expect(event.context.reason).toBe('missing_credential');
      expect(event.context.count).toBe(1);
    });

    it(`${name} distinguishes a wrong credential from a missing one in telemetry`, async () => {
      await post(name, { 'x-ingest-secret': SAME_LENGTH_WRONG });
      expect(recordEventMock.mock.calls[0][0].context.reason).toBe('invalid_credential');
    });

    it(`${name} records nothing when the request is properly authenticated`, async () => {
      const { response } = await post(name, { 'x-ingest-secret': SECRET });
      expect(response.status).toBe(200);
      expect(recordEventMock).not.toHaveBeenCalled();
    });

    it(`${name} throttles telemetry instead of one row per legacy request`, async () => {
      const mod = await loadRoute(name);
      for (let i = 0; i < 5; i += 1) {
        const res = await mod.POST(makeRequest(name));
        expect(res.status).toBe(200);
      }
      expect(recordEventMock).toHaveBeenCalledTimes(1);
      expect(recordEventMock.mock.calls[0][0].context.count).toBe(1);
    });

    it(`${name} survives a monitoring failure without changing its answer`, async () => {
      recordEventMock.mockImplementation(async () => {
        throw new Error('system_events unreachable');
      });
      const { response, body } = await post(name);
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });
  }
});

/* ── Stage 3: secret set + enforcement on ────────────────────────────────── */

describe('stage "enforce": secret set, DESKTOP_INGEST_ENFORCE=1', () => {
  beforeEach(() => {
    process.env.DESKTOP_INGEST_SECRET = SECRET;
    process.env.DESKTOP_INGEST_ENFORCE = '1';
  });

  for (const name of ROUTES) {
    it(`${name} rejects a request with no credential`, async () => {
      const { response, body } = await post(name);
      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it(`${name} rejects before touching the database`, async () => {
      await post(name);
      expect(supabaseState.client.from).not.toHaveBeenCalled();
      expect(supabaseState.client.storage.from).not.toHaveBeenCalled();
    });

    it(`${name} accepts the x-ingest-secret header`, async () => {
      const { response, body } = await post(name, { 'x-ingest-secret': SECRET });
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it(`${name} accepts the same value as a Bearer token`, async () => {
      const { response } = await post(name, { authorization: `Bearer ${SECRET}` });
      expect(response.status).toBe(200);
    });

    it(`${name} rejects a wrong secret of the same length`, async () => {
      const { response } = await post(name, { 'x-ingest-secret': SAME_LENGTH_WRONG });
      expect(response.status).toBe(401);
    });

    it(`${name} rejects a wrong secret of a different length without throwing`, async () => {
      const { response } = await post(name, { 'x-ingest-secret': SHORT_WRONG });
      expect(response.status).toBe(401);
    });

    it(`${name} rejects a wrong Bearer token`, async () => {
      const { response } = await post(name, { authorization: `Bearer ${SHORT_WRONG}` });
      expect(response.status).toBe(401);
    });

    it(`${name} records the rejection`, async () => {
      await post(name);
      const event = recordEventMock.mock.calls[0][0];
      expect(event.type).toBe('api.ingest_unauthenticated_rejected');
      expect(event.severity).toBe('warning');
      expect(event.context.statusCode).toBe(401);
    });

    it(`${name} never echoes the secret in a rejection`, async () => {
      const res = await (await loadRoute(name)).POST(
        makeRequest(name, { 'x-ingest-secret': SAME_LENGTH_WRONG })
      );
      const text = await res.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SAME_LENGTH_WRONG);
      const logged = warnSpy.mock.calls.flat().join(' ');
      expect(logged).not.toContain(SECRET);
      const recorded = JSON.stringify(recordEventMock.mock.calls);
      expect(recorded).not.toContain(SECRET);
      expect(recorded).not.toContain(SAME_LENGTH_WRONG);
    });
  }

  it('upload-screenshot still performs its normal work for an authenticated call', async () => {
    const { response, body } = await post('upload-screenshot', { 'x-ingest-secret': SECRET });
    expect(response.status).toBe(200);
    expect(body.path).toMatch(new RegExp(`^${ORG_ID}/${DEV_ID}/`));
    expect(supabaseState.client.uploads).toHaveLength(1);
    expect(supabaseState.client.inserts[0].table).toBe('screenshots');
  });

  it('track-activity still validates an authenticated call the same way', async () => {
    const mod = await loadRoute('track-activity');
    const request = new Request('http://localhost/api/track-activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-secret': SECRET },
      body: JSON.stringify([]),
    });
    const response = await mod.POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('No activities supplied');
  });
});

/* ── Misconfiguration: enforcement asked for with no secret ──────────────── */

describe('misconfigured: DESKTOP_INGEST_ENFORCE set without a secret', () => {
  beforeEach(() => {
    process.env.DESKTOP_INGEST_ENFORCE = 'true';
  });

  for (const name of ROUTES) {
    it(`${name} fails closed rather than reverting to open`, async () => {
      const { response, body } = await post(name, { 'x-ingest-secret': SECRET });
      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it(`${name} says so at import time`, async () => {
      await loadRoute(name);
      const warnings = warnSpy.mock.calls.map((call) => call.join(' '));
      expect(warnings.some((w) => w.includes('DESKTOP_INGEST_ENFORCE is on but'))).toBe(true);
    });
  }
});

/* ── Constant-time verification ──────────────────────────────────────────── */

describe('credential comparison is constant time', () => {
  beforeEach(() => {
    process.env.DESKTOP_INGEST_SECRET = SECRET;
  });

  for (const name of ROUTES) {
    it(`${name} compares with crypto.timingSafeEqual, never ===`, async () => {
      await post(name, { 'x-ingest-secret': SECRET });
      expect(timingSafeEqualSpy).toHaveBeenCalled();
    });

    it(`${name} hands it equal-length 32-byte digests, so no length is leaked`, async () => {
      await post(name, { 'x-ingest-secret': SHORT_WRONG });
      expect(timingSafeEqualSpy).toHaveBeenCalled();
      for (const [a, b] of timingSafeEqualSpy.mock.calls) {
        expect(a).toHaveLength(32);
        expect(b).toHaveLength(32);
        expect(a.length).toBe(b.length);
      }
    });

    it(`${name} still runs the comparison when no credential is supplied at all`, async () => {
      await post(name);
      expect(timingSafeEqualSpy).toHaveBeenCalled();
    });
  }
});

/* ── Enabling enforcement is a deliberate act ────────────────────────────── */

describe('DESKTOP_INGEST_ENFORCE parsing', () => {
  beforeEach(() => {
    process.env.DESKTOP_INGEST_SECRET = SECRET;
  });

  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
    it(`treats ${JSON.stringify(value)} as enforcement on`, async () => {
      process.env.DESKTOP_INGEST_ENFORCE = value;
      const { response } = await post('track-activity');
      expect(response.status).toBe(401);
    });
  }

  for (const value of ['', '0', 'false', 'no', 'off', 'later']) {
    it(`treats ${JSON.stringify(value)} as enforcement off`, async () => {
      process.env.DESKTOP_INGEST_ENFORCE = value;
      const { response } = await post('track-activity');
      expect(response.status).toBe(200);
    });
  }
});
