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
 * STILL OUTSTANDING (Phase 2): the `documents` bucket is public and has no
 * policy in version control. Screenshots should move to a private bucket read
 * through signed URLs — that requires changing every reader, so it is not done
 * here. Existing rows keep their old public_url and remain enumerable.
 */

// ~8 MB of base64 ≈ 6 MB of PNG.
const MAX_BASE64_CHARS = 8 * 1024 * 1024;

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

    const { developer_id, image_data, session_id, context, timestamp } = await request.json();

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

    // Org-prefixed and unguessable. The org prefix also matches the folder
    // convention a future bucket policy will key on.
    const orgPrefix = developer.organization_id || 'unassigned';
    const fileName = `screenshots/${orgPrefix}/${developer.id}/${Date.now()}-${crypto.randomUUID()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, base64ToBuffer(image_data), {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(fileName);

    // Save to database. Only REAL columns of the screenshots table are written:
    // public_url is the canonical URL the desktop app writes and every reader
    // displays. (image_url / thumbnail_url / activity_context / session_id do
    // NOT exist in this table's schema and previously made this insert fail.)
    const { error } = await supabase
      .from('screenshots')
      .insert([
        {
          developer_id: developer.id,
          organization_id: developer.organization_id,
          public_url: urlData.publicUrl,
          storage_path: fileName,
          filename: fileName.split('/').pop(),
          annotation_text: context || null,
          timestamp: safeTimestamp(timestamp)
        }
      ]);

    if (error) throw error;

    // Also record as activity
    await supabase
      .from('developer_activities')
      .insert([
        {
          developer_id: developer.id,
          organization_id: developer.organization_id,
          activity_type: 'screenshot',
          activity_data: {
            context: context,
            image_url: urlData.publicUrl
          },
          session_id,
          productivity_score: 0.7,
          timestamp: safeTimestamp(timestamp)
        }
      ]);

    return NextResponse.json({
      success: true,
      message: 'Screenshot uploaded successfully',
      url: urlData.publicUrl
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
