import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { recordEvent } from '@/utils/systemEvents';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Desktop tracker screenshot ingest.
 *
 * SECURITY (audit finding C7 / C17): this route had no authentication, took
 * developer_id from the body, accepted an unbounded payload, and wrote to a
 * PUBLIC bucket at the fully guessable path `screenshots/{developer_id}/{ms}.png`
 * — so anyone who knew a developer id could both forge and enumerate another
 * employee's screen captures.
 *
 * The desktop client lives outside this repository, so hard JWT auth would
 * break every installed agent. Hardening applied here is safe to deploy today:
 *
 *   1. A STAGED shared-secret gate — see "INGEST AUTHENTICATION" below. Same
 *      contract as /api/track-activity.
 *   2. developer_id must reference a real developer; organization is derived
 *      from that row, never from the body.
 *   3. Storage path is now org-prefixed AND carries a random component, so new
 *      uploads cannot be enumerated even while the bucket remains public.
 *   4. Payload size cap.
 *
 * PHASE 2 (audit finding H2): screenshots no longer go to the public `documents`
 * bucket at all. They are written to the PRIVATE `monitoring` bucket created in
 * migration 019, and readers mint short-lived signed URLs via
 * `src/utils/screenshotFiles.js`. A storage policy limits signing to members of
 * the owning organization, so the org id in the path is enforced by the database.
 *
 * Rows written before this change keep their old public_url and still render;
 * they remain publicly reachable until those objects are migrated across.
 */

// ~8 MB of base64 ≈ 6 MB of PNG.
const MAX_BASE64_CHARS = 8 * 1024 * 1024;

// Private bucket — must match SCREENSHOT_BUCKET in src/utils/screenshotFiles.js.
const SCREENSHOT_BUCKET = 'monitoring';

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
 * This block is deliberately identical in src/app/api/track-activity/route.js
 * (only ROUTE_NAME differs) — the two ingest endpoints share one contract and
 * must never drift apart.
 */

const ROUTE_NAME = '/api/upload-screenshot';

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

// Loud on boot: an unset secret means anyone who knows a developer id can inject
// screenshots into a real employee's timeline, and that must not stay quiet.
if (!ingestSecret()) {
  // eslint-disable-next-line no-console
  console.warn(
    enforcementEnabled()
      ? `[ingest] ${ROUTE_NAME}: DESKTOP_INGEST_ENFORCE is on but DESKTOP_INGEST_SECRET is unset — ` +
          'every ingest request will be rejected with 401 (fail closed). Set the secret.'
      : `[ingest] ${ROUTE_NAME}: DESKTOP_INGEST_SECRET is NOT set — this endpoint accepts ` +
          'UNAUTHENTICATED uploads from anyone who knows a developer id. Screenshot evidence can be ' +
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

    const { developer_id, image_data, context, timestamp } = await request.json();

    if (!developer_id || !image_data) {
      return NextResponse.json(
        { error: 'developer_id and image_data are required' },
        { status: 400 }
      );
    }
    if (typeof image_data !== 'string' || image_data.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: 'Screenshot too large' }, { status: 413 });
    }

    // Identity must be real; organization comes from the developer row.
    const { data: developer } = await supabase
      .from('developers')
      .select('id, organization_id')
      .eq('id', developer_id)
      .maybeSingle();

    if (!developer) {
      return NextResponse.json({ error: 'Unknown developer' }, { status: 403 });
    }

    // The leading path segment is the organization id — the storage policy in
    // migration 019 reads it to decide who may sign this object. The random
    // component keeps objects unguessable.
    const orgPrefix = developer.organization_id || 'unassigned';
    const fileName = `${orgPrefix}/${developer.id}/${Date.now()}-${crypto.randomUUID()}.png`;

    const { error: uploadError } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .upload(fileName, base64ToBuffer(image_data), {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Save to database. Only REAL columns of the screenshots table are written.
    // public_url is deliberately left null for private-bucket objects: there is
    // no durable URL any more, readers sign storage_path on demand. (image_url /
    // thumbnail_url / activity_context / session_id do NOT exist in this
    // table's schema and previously made this insert fail.)
    const { error } = await supabase
      .from('screenshots')
      .insert([
        {
          developer_id: developer.id,
          organization_id: developer.organization_id,
          storage_path: fileName,
          filename: fileName.split('/').pop(),
          annotation_text: context || null,
          timestamp: safeTimestamp(timestamp)
        }
      ]);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Screenshot uploaded successfully',
      path: fileName
    });

  } catch {
    return NextResponse.json(
      { error: 'Failed to upload screenshot' },
      { status: 500 }
    );
  }
}

function safeTimestamp(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function base64ToBuffer(base64String) {
  return Buffer.from(base64String, 'base64');
}
