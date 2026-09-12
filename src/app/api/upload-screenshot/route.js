import { verifyDeviceRequest } from "@/utils/deviceAuth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { recordEvent } from '@/utils/systemEvents';
import { rateLimited } from '@/utils/rateLimit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Production requires a registered device session JWT. The historical staged
// rollout described below now applies only outside production.

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
 * PHASE 2 (audit finding H2): screenshots written by THIS ROUTE go to the
 * PRIVATE `monitoring` bucket created in migration 019, and readers mint
 * short-lived signed URLs via `src/utils/screenshotFiles.js`. The storage policy
 * installed by 019 and narrowed by 040 limits signing to people entitled to that
 * developer's data, so the path is what enforces access.
 *
 * ─── WHERE THE LEGACY OBJECTS REALLY ARE ────────────────────────────────────
 *
 * 019 and the previous version of this comment both said the old captures live
 * in the public `documents` bucket under a `screenshots/` prefix. They do not.
 * The live project has a separate PUBLIC BUCKET named `screenshots`, and its
 * objects are keyed `{email_local_part}/{file}.jpg` with no prefix at all. Every
 * consequence of that error is documented in docs/screenshot-bucket-migration.md
 * — the short version is that 019's progress query and this repository's legacy
 * detector both keyed off a `screenshots/` prefix that has never existed, so the
 * cleanup looked finished while every object was still world-readable.
 *
 * Rows written before Phase 2 keep their old public_url and still render; they
 * remain publicly reachable until scripts/migrate-screenshots.mjs moves them and
 * the owner flips that bucket private.
 */

// ~8 MB of base64 ≈ 6 MB of PNG.
const MAX_BASE64_CHARS = 8 * 1024 * 1024;

// How many captures one person can have written against them in a window.
// A desktop agent on a 30-second interval sends 120 in an hour; 240 leaves
// generous headroom for retries and clock drift while still bounding what an
// anonymous caller can do in the open stage. Per-process — see utils/rateLimit.
const MAX_UPLOADS_PER_WINDOW = 240;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

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
  // Production ingest requires a registered device session.
  if (process.env.NODE_ENV === "production") return true;
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
  if (process.env.NODE_ENV === 'production') {
    return { allow: false, authenticated: false, stage: 'device', reason: 'device_session_required' };
  }
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
if (process.env.NODE_ENV !== 'production' && !ingestSecret()) {
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
    const auth = await verifyDeviceRequest(request) || authorizeIngest(request);
    const db = auth.client || supabase;
    if (!auth.authenticated) await reportUnauthenticated(auth);
    if (!auth.allow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { developer_id, image_data, context, timestamp, capture_id } = body;
    if (capture_id != null && (typeof capture_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(capture_id))) {
      return NextResponse.json({ error: "capture_id must be a UUID" }, { status: 400 });
    }
    if ((context != null && (typeof context !== "string" || context.length > 10000)) ||
        (timestamp != null && (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))))) {
      return NextResponse.json({ error: "Invalid screenshot context or timestamp" }, { status: 400 });
    }

    if (auth.developerId && developer_id !== auth.developerId) return NextResponse.json({ error: 'Device cannot submit another member’s screenshot' }, { status: 403 });

    if (!developer_id || !image_data) {
      return NextResponse.json(
        { error: 'developer_id and image_data are required' },
        { status: 400 }
      );
    }
    if (typeof image_data !== 'string' || image_data.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: 'Screenshot too large' }, { status: 413 });
    }

    // THE PAYLOAD MUST ACTUALLY BE A PNG.
    //
    // `Buffer.from(str, 'base64')` silently discards anything that is not a
    // base64 character, so it never throws and never rejects: arbitrary bytes
    // landed in the monitoring bucket labelled image/png. The stored
    // content-type is hardcoded below, so this was not a stored-XSS route —
    // it was a free, unmetered blob store (the `screenshots` plan limit is
    // enforced nowhere) reachable, in the open stage, with no credential.
    //
    // Checked on the DECODED bytes, because that is what gets stored.
    const buffer = base64ToBuffer(image_data);
    if (buffer.length > 6 * 1024 * 1024) return NextResponse.json({ error: "Screenshot too large" }, { status: 413 });
    const dimensions = pngDimensions(buffer);
    if (!dimensions) {
      return NextResponse.json(
        { error: 'image_data must be a base64-encoded PNG' },
        { status: 415 }
      );
    }

    // RATE LIMIT. Keyed on the subject, not the caller: in the open stage there
    // is no caller identity to key on, and the thing worth bounding is how much
    // can be written against one person. An authenticated agent capturing on a
    // normal interval stays far below this.
    if (rateLimited(`screenshot:${developer_id}`, { max: MAX_UPLOADS_PER_WINDOW, windowMs: UPLOAD_WINDOW_MS })) {
      return NextResponse.json({ error: 'Too many screenshots' }, { status: 429 });
    }

    // Identity must be real; organization comes from the developer row.
    const { data: developer, error: developerError } = await db
      .from('developers')
      .select('id, organization_id, email')
      .eq('id', developer_id)
      .maybeSingle();

    if (developerError) return NextResponse.json({ error: "Developer lookup unavailable" }, { status: 503 });
    if (!developer) {
      // NO ORACLE WHEN UNAUTHENTICATED. `403 Unknown developer` versus a 200
      // told an anonymous caller whether a given uuid names a real person, in
      // any tenant — a free identifier-validation service, and the first step
      // of forging captures against a named employee. Authenticated agents
      // still get the diagnostic, because by then the caller has proved it is
      // ours and a misconfigured agent is worth reporting.
      if (!auth.authenticated) {
        return NextResponse.json({ success: true, message: 'Accepted' }, { status: 202 });
      }
      return NextResponse.json({ error: 'Unknown developer' }, { status: 403 });
    }

    if (!developer.organization_id || !developer.email || (auth.orgId && auth.orgId !== developer.organization_id)) {
      return NextResponse.json({ error: "Developer identity is incomplete" }, { status: 403 });
    }
    const orgPrefix = developer.organization_id;
    const captureId = (capture_id || crypto.randomUUID()).toLowerCase();
    const fileName = `${orgPrefix}/${developer.id}/capture_${captureId}.png`;
    let previous = null;
    if (auth.client) {
      const lookup = await db.from('screenshots').select('capture_metadata, storage_path')
        .eq('organization_id', orgPrefix).eq('capture_id', captureId).maybeSingle();
      if (lookup.error) return NextResponse.json({ error: 'Capture receipt lookup unavailable' }, { status: 503 });
      previous = lookup.data;
    }
    const metadata = {
      organization_id: orgPrefix, developer_id: developer.id, developer_email: developer.email,
      filename: fileName.split('/').pop(), storage_path: fileName, public_url: null,
      width: dimensions.width, height: dimensions.height, size_kb: Number((buffer.length / 1024).toFixed(2)),
      mime_type: 'image/png', app_active: null, is_annotated: Boolean(context), annotation_text: context || null,
      timestamp: timestamp ? new Date(timestamp).toISOString() : previous?.capture_metadata?.timestamp || new Date().toISOString(),
    };
    if (previous && (previous.storage_path !== fileName || !sameMetadata(previous.capture_metadata, metadata))) {
      return NextResponse.json({ error: 'Capture ID already belongs to different screenshot metadata' }, { status: 409 });
    }
    // Read the current organization policy before sending new private bytes.
    // The database also enforces this against direct Storage / table requests.
    // Existing receipts can still be acknowledged without creating a capture.
    if (auth.client && !previous) {
      let policy;
      try { policy = await db.rpc('get_screenshot_policy'); }
      catch { return NextResponse.json({ error: 'Screenshot policy unavailable' }, { status: 503 }); }
      if (policy.error || policy.data?.organization_id !== orgPrefix || typeof policy.data?.enabled !== 'boolean') {
        return NextResponse.json({ error: 'Screenshot policy unavailable' }, { status: 503 });
      }
      if (!policy.data.enabled) return NextResponse.json({ error: 'Screenshots are disabled by organization policy' }, { status: 403 });
    }
    // Immutable upload only. A timeout/duplicate can mean this exact object was
    // already committed; verify bytes before finalizing instead of overwriting.
    let uploadError = previous ? new Error("Existing receipt requires object verification") : null;
    if (!previous) try {
      ({ error: uploadError } = await db.storage.from(SCREENSHOT_BUCKET).upload(fileName, buffer, {
        contentType: 'image/png', upsert: false,
      }));
    } catch (error) { uploadError = error; }
    if (uploadError) {
      let existing;
      try { existing = await db.storage.from(SCREENSHOT_BUCKET).download(fileName); }
      catch { return NextResponse.json({ error: 'Screenshot upload could not be confirmed', capture_id: captureId }, { status: 503 }); }
      if (existing.error || !existing.data) return NextResponse.json({ error: 'Screenshot upload could not be confirmed' }, { status: 503 });
      if (existing.data.size !== buffer.length) return NextResponse.json({ error: 'Capture ID already belongs to different screenshot bytes' }, { status: 409 });
      const stored = Buffer.from(await existing.data.arrayBuffer());
      if (stored.length !== buffer.length || !crypto.timingSafeEqual(
        crypto.createHash('sha256').update(stored).digest(), crypto.createHash('sha256').update(buffer).digest())) {
        return NextResponse.json({ error: 'Capture ID already belongs to different screenshot bytes' }, { status: 409 });
      }
    }
    if (auth.client) {
      const finalized = await db.rpc('finalize_screenshot_capture', { p_capture_id: captureId, p_metadata: metadata });
      if (finalized.error || !finalized.data?.success || finalized.data.storage_path !== fileName || finalized.data.capture_id !== captureId) {
        const message = finalized.error?.message || '';
        const status = message.startsWith('SCREENSHOT_CAPTURE_CONFLICT') ? 409
          : /^(PLAN_LIMIT_REACHED|BILLING_LOCKED|PLAN_FEATURE_REQUIRED)/.test(message) ? 402
          : finalized.error?.code === '42501' ? 403 : 503;
        return NextResponse.json({ error: 'Screenshot metadata could not be confirmed', capture_id: captureId }, { status });
      }
    } else {
      // Existing nonproduction staged clients have no authenticated device RPC
      // context. Keep their guarded legacy insert but supply every required field.
      const { error } = await db.from('screenshots').insert([metadata]);
      if (error) return NextResponse.json({ error: 'Screenshot metadata could not be confirmed' }, { status: 503 });
    }
    return NextResponse.json({ success: true, message: 'Screenshot uploaded successfully', path: fileName, capture_id: captureId });

  } catch {
    return NextResponse.json(
      { error: 'Failed to upload screenshot' },
      { status: 500 }
    );
  }
}

function sameMetadata(left, right) {
  return left && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(right).every(key => left[key] === right[key]);
}

function base64ToBuffer(base64String) {
  return Buffer.from(base64String, 'base64');
}

// Read the mandatory first PNG IHDR chunk without trusting submitted dimensions.
function pngDimensions(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384) return null;
  return { width, height };
}
