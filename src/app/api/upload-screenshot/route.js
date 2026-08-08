import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
 *   1. OPTIONAL shared secret via DESKTOP_INGEST_SECRET (see track-activity).
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

function ingestAuthorized(request) {
  const secret = process.env.DESKTOP_INGEST_SECRET;
  if (!secret) return true; // enforcement not enabled yet
  const header =
    request.headers.get('x-ingest-secret') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return header === secret;
}

export async function POST(request) {
  try {
    if (!ingestAuthorized(request)) {
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
