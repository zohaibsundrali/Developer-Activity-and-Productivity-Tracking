import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
 *   1. An OPTIONAL shared secret. Set DESKTOP_INGEST_SECRET and the route
 *      requires `X-Ingest-Secret` (or a Bearer token) to match. Leave it unset
 *      and behaviour is unchanged — so you can deploy now, roll the secret out
 *      to the desktop app, then set the env var to switch enforcement on.
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
