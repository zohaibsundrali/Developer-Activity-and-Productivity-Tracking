import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { recordEvent } from '@/utils/systemEvents';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Desktop tracker ingest.
 *
 * SECURITY (audit finding C7): this route had no authentication and inserted
 * the raw request body with the service-role key, so anyone could spoof any
 * developer_id, set any column (including organization_id), and flood the
 * table. The desktop client lives outside this repository, so requiring a JWT
 * outright would break every installed agent. The hardening here is therefore
 * layered so it is safe to deploy today:
 *
 *   1. A STAGED shared-secret gate — see "INGEST AUTHENTICATION" below.
 *   2. Column allow-listing. Only known columns are inserted, so a caller can
 *      no longer set organization_id or any other column by mass assignment.
 *   3. Identity validation. developer_id must reference a real developer, and
 *      organization_id is derived from that row on the server.
 *   4. Payload limits, so an unauthenticated caller cannot exhaust storage.
 *
 * Until DESKTOP_INGEST_SECRET is set this endpoint is still writable by an
 * anonymous caller who knows a valid developer id — but they can no longer
 * reach another tenant, invent columns, or submit unbounded payloads.
 */

const MAX_ACTIVITIES = 500;

// Columns a client is allowed to supply. Everything else is ignored.
const ALLOWED_FIELDS = [
  'developer_id',
  'activity_type',
  'activity_data',
  'session_id',
  'timestamp',
];

/* ─────────────────────────── INGEST AUTHENTICATION ─────────────────────────
 *
 * The desktop tracker is a separate program already installed on customer
 * machines and cannot be updated from this repository, so this gate CANNOT be
 * flipped closed in one step without stopping tracking for every existing
 * customer. It is therefore staged, driven by two independent env vars:
 *
 *   DESKTOP_INGEST_SECRET   the shared secret agents must present
 *   DESKTOP_INGEST_ENFORCE  1/true/yes/on to reject unauthenticated requests
 *
 *   ┌ secret ┬ enforce ┬ stage ────────┬ unauthenticated request ─────────────┐
 *   │  unset │  unset  │ open          │ ACCEPTED (today's behaviour) + loud  │
 *   │        │         │ (default)     │ warning at import and telemetry      │
 *   │  set   │  unset  │ observe       │ ACCEPTED + recorded, so the owner can│
 *   │        │         │               │ see how many agents are still legacy │
 *   │  set   │  set    │ enforce       │ 401                                  │
 *   │  unset │  set    │ misconfigured │ 401 — enforcement was asked for and  │
 *   │        │         │               │ nothing can authenticate; fails      │
 *   │        │         │               │ CLOSED like /api/cron rather than    │
 *   │        │         │               │ silently reopening the hole          │
 *   └────────┴─────────┴───────────────┴──────────────────────────────────────┘
 *
 * Nothing changes until the owner sets a variable. See docs/desktop-ingest-auth.md
 * for the contract the desktop agent must implement.
 *
 * This block is deliberately identical in src/app/api/upload-screenshot/route.js
 * (only ROUTE_NAME differs) — the two ingest endpoints share one contract and
 * must never drift apart.
 */

const ROUTE_NAME = '/api/track-activity';

// Telemetry must not turn one chatty legacy agent into thousands of rows in
// system_events, so unauthenticated requests are counted and reported at most
// once per window, carrying the suppressed count.
const UNAUTH_REPORT_INTERVAL_MS = 10 * 60 * 1000;
let unauthSinceReport = 0;
let unauthReportedAt = 0;

function ingestSecret() {
  const secret = process.env.DESKTOP_INGEST_SECRET;
  return typeof secret === 'string' && secret.length > 0 ? secret : null;
}

function enforcementEnabled() {
  const flag = String(process.env.DESKTOP_INGEST_ENFORCE || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
}

function presentedCredential(request) {
  const header = request.headers.get('x-ingest-secret');
  if (header) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return bearer ? bearer[1].trim() : '';
}

/**
 * Constant-time comparison. Both sides are hashed first so the buffers handed
 * to timingSafeEqual are always 32 bytes: that removes the length leak (and the
 * throw on unequal lengths) that a naive `===` or a raw buffer compare has.
 */
function credentialMatches(presented, secret) {
  const a = crypto.createHash('sha256').update(String(presented), 'utf8').digest();
  const b = crypto.createHash('sha256').update(secret, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/** @returns {{allow: boolean, authenticated: boolean, stage: string, reason: string}} */
function authorizeIngest(request) {
  const secret = ingestSecret();
  const enforce = enforcementEnabled();

  if (secret && credentialMatches(presentedCredential(request), secret)) {
    return { allow: true, authenticated: true, stage: enforce ? 'enforce' : 'observe', reason: 'authenticated' };
  }
  if (!secret) {
    return enforce
      ? { allow: false, authenticated: false, stage: 'misconfigured', reason: 'enforce_without_secret' }
      : { allow: true, authenticated: false, stage: 'open', reason: 'no_secret_configured' };
  }
  return {
    allow: !enforce,
    authenticated: false,
    stage: enforce ? 'enforce' : 'observe',
    reason: presentedCredential(request) ? 'invalid_credential' : 'missing_credential',
  };
}

/**
 * Best effort, throttled, and never allowed to affect the response — recordEvent
 * already swallows every failure (see src/utils/systemEvents.js); the try/catch
 * is belt-and-braces so a future change there cannot throw into an ingest call.
 * The secret is never included: only a stage, a machine-readable reason and a
 * count are recorded.
 */
async function reportUnauthenticated(decision) {
  unauthSinceReport += 1;
  const now = Date.now();
  if (unauthReportedAt && now - unauthReportedAt < UNAUTH_REPORT_INTERVAL_MS) return;

  const count = unauthSinceReport;
  unauthSinceReport = 0;
  unauthReportedAt = now;

  // eslint-disable-next-line no-console
  console.warn(
    `[ingest] ${ROUTE_NAME}: ${count} unauthenticated request(s) (${decision.reason}); ` +
      `stage=${decision.stage}, ${decision.allow ? 'ACCEPTED — this endpoint is still open' : 'rejected with 401'}. ` +
      'See docs/desktop-ingest-auth.md.'
  );

  try {
    await recordEvent({
      orgId: null,
      type: decision.allow ? 'api.ingest_unauthenticated_accepted' : 'api.ingest_unauthenticated_rejected',
      severity: 'warning',
      source: 'api',
      message: decision.allow
        ? `${ROUTE_NAME} accepted ${count} unauthenticated desktop ingest request(s) — legacy agents are still reporting without a secret.`
        : `${ROUTE_NAME} rejected ${count} unauthenticated desktop ingest request(s).`,
      context: {
        route: ROUTE_NAME,
        reason: decision.reason,
        status: decision.stage,
        statusCode: decision.allow ? 200 : 401,
        count,
      },
    });
  } catch {
    /* monitoring must never break ingest */
  }
}

// Loud on boot: an unset secret means this endpoint is writable by anyone who
// knows a developer id, and that must not be able to stay quiet for another year.
if (!ingestSecret()) {
  // eslint-disable-next-line no-console
  console.warn(
    enforcementEnabled()
      ? `[ingest] ${ROUTE_NAME}: DESKTOP_INGEST_ENFORCE is on but DESKTOP_INGEST_SECRET is unset — ` +
          'every ingest request will be rejected with 401 (fail closed). Set the secret.'
      : `[ingest] ${ROUTE_NAME}: DESKTOP_INGEST_SECRET is NOT set — this endpoint accepts ` +
          'UNAUTHENTICATED writes from anyone who knows a developer id. Activity timelines can be ' +
          'forged. Set DESKTOP_INGEST_SECRET, then DESKTOP_INGEST_ENFORCE=1. See docs/desktop-ingest-auth.md.'
  );
}

export async function POST(request) {
  try {
    const auth = authorizeIngest(request);
    if (!auth.authenticated) await reportUnauthenticated(auth);
    if (!auth.allow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const activities = Array.isArray(body) ? body : [body];

    if (!activities.length) {
      return NextResponse.json({ error: 'No activities supplied' }, { status: 400 });
    }
    if (activities.length > MAX_ACTIVITIES) {
      return NextResponse.json(
        { error: `Too many activities (max ${MAX_ACTIVITIES})` },
        { status: 413 }
      );
    }

    // Every row must name the same known developer; the organization is then
    // derived server-side rather than trusted from the payload.
    const developerIds = [...new Set(activities.map((a) => a?.developer_id).filter(Boolean))];
    if (developerIds.length !== 1) {
      return NextResponse.json(
        { error: 'Each request must carry exactly one developer_id' },
        { status: 400 }
      );
    }

    const { data: developer } = await supabase
      .from('developers')
      .select('id, organization_id')
      .eq('id', developerIds[0])
      .maybeSingle();

    if (!developer) {
      return NextResponse.json({ error: 'Unknown developer' }, { status: 403 });
    }

    const rows = activities.map((a) => {
      const row = {};
      for (const field of ALLOWED_FIELDS) {
        if (a[field] !== undefined) row[field] = a[field];
      }
      row.developer_id = developer.id;
      row.organization_id = developer.organization_id;
      row.productivity_score = scoreFor(a);
      return row;
    });

    // `developer_activities` does not exist in the database and never has, so
    // this endpoint has been returning 500 on every call since it was written.
    // Nothing reads that table: the desktop tracker already writes the real
    // per-signal tables (keyboard_stats, mouse_activities, app_usage,
    // browser_usage, screenshots, productivity_sessions), which is where every
    // report and dashboard reads from.
    //
    // Creating the table would start accumulating rows from an endpoint that is
    // still unauthenticated whenever DESKTOP_INGEST_SECRET is unset, with no
    // consumer — so the payload is validated and acknowledged, and nothing is
    // written. Answering 200 rather than 500 also stops installed agents
    // retrying a call that can never succeed.
    return NextResponse.json({
      success: true,
      message: 'Accepted. This endpoint is retired; per-signal tables are the system of record.',
      accepted: rows.length,
      stored: 0,
      deprecated: true,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to track activities' },
      { status: 500 }
    );
  }
}

// Score is computed up-front and inserted with the row, replacing the previous
// per-row UPDATE loop (one query per activity).
function scoreFor(activity) {
  switch (activity?.activity_type) {
    case 'keyboard':
      return 0.8;
    case 'mouse':
      return 0.6;
    case 'app_switch':
      return isProductiveApp(activity?.activity_data?.application?.toLowerCase()) ? 0.9 : 0.3;
    case 'idle':
      return 0.1;
    default:
      return 0.5;
  }
}

function isProductiveApp(appName) {
  const productiveApps = [
    'vscode', 'code', 'sublime', 'pycharm', 'webstorm', 'intellij',
    'terminal', 'cmd', 'powershell', 'bash', 'git', 'github',
    'visual studio', 'eclipse', 'android studio'
  ];

  return productiveApps.some(prodApp =>
    appName?.includes(prodApp)
  );
}
