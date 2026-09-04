import { NextResponse } from "next/server";
import { recordEvent } from "@/utils/systemEvents";

/**
 * Content-Security-Policy violation sink.
 *
 * The policy in next.config.mjs ships as Content-Security-Policy-Report-Only and
 * points its `report-uri` / `report-to` here. Before this route existed the
 * policy reported to nowhere, so "promote to enforcing once the reports are
 * clean" could never be evaluated — there were no reports. This turns the
 * Report-Only header into real telemetry, recorded to `system_events` and
 * visible in Admin → System Health, so a genuine violation (a Supabase Storage
 * image the policy forgot, a third-party script) surfaces before anyone flips
 * the header to enforcing.
 *
 * Two wire formats, both handled:
 *   - the legacy `report-uri`: Content-Type application/csp-report,
 *     body { "csp-report": { "violated-directive", "blocked-uri", ... } }
 *   - the modern `report-to`: Content-Type application/reports+json,
 *     body [ { "type": "csp-violation", "body": { "effectiveDirective", ... } } ]
 *
 * The endpoint is public by necessity — the browser posts it, unauthenticated,
 * from every page including /login — so it does the minimum: parse, throttle,
 * record, and always answer 204. It never trusts the body beyond reducing it to
 * a short directive name and the blocked resource's origin; the full report is
 * summarised into `message`, which recordEvent scrubs and truncates.
 */

export const runtime = "nodejs";

const ROUTE_NAME = "/api/csp-report";

// Throttle: at most one recorded event per (directive, blocked-origin) per
// process per window. A misconfigured policy can otherwise emit a report on
// every asset of every page load — a flood that buries the signal and fills
// system_events. `count` carries how many were seen since the last record.
const REPORT_INTERVAL_MS = 10 * 60 * 1000;
const seen = new Map(); // key -> { at: number, count: number }

/** Pull the two fields we key on from either wire format's violation body. */
function normalise(report) {
  if (!report || typeof report !== "object") return null;
  const directive =
    report["violated-directive"] ||
    report["effective-directive"] ||
    report.effectiveDirective ||
    report.violatedDirective ||
    "unknown";
  const blocked =
    report["blocked-uri"] || report.blockedURL || report.blockedUri || "";
  const document =
    report["document-uri"] || report.documentURL || report.documentUri || "";
  // Just the directive name (e.g. "img-src"), never the full policy string.
  const directiveName = String(directive).split(/\s+/)[0].slice(0, 40) || "unknown";
  // Just the origin of the blocked resource — enough to say "Supabase image"
  // or "some CDN" without logging a full URL with ids in it.
  let blockedOrigin = "inline";
  const raw = String(blocked);
  if (raw && raw !== "self") {
    try {
      blockedOrigin = new URL(raw).origin;
    } catch {
      blockedOrigin = raw.slice(0, 60); // "data", "eval", "blob", a scheme, etc.
    }
  }
  let documentPath = "";
  try {
    documentPath = new URL(String(document)).pathname.slice(0, 80);
  } catch {
    documentPath = String(document).slice(0, 80);
  }
  return { directiveName, blockedOrigin, documentPath };
}

/** Every violation object carried by either wire format. */
function extractReports(payload) {
  if (Array.isArray(payload)) {
    // report-to: an array of reports; keep only the CSP ones.
    return payload
      .filter((r) => !r?.type || r.type === "csp-violation")
      .map((r) => r?.body || r)
      .filter(Boolean);
  }
  if (payload && typeof payload === "object") {
    // report-uri: a single { "csp-report": {...} }.
    if (payload["csp-report"]) return [payload["csp-report"]];
    return [payload];
  }
  return [];
}

async function record(v) {
  const key = `${v.directiveName}|${v.blockedOrigin}`;
  const now = Date.now();
  const prev = seen.get(key);
  if (prev && now - prev.at < REPORT_INTERVAL_MS) {
    prev.count += 1;
    return;
  }
  const count = prev ? prev.count + 1 : 1;
  seen.set(key, { at: now, count: 1 });

  try {
    await recordEvent({
      orgId: null, // page loads are not org-scoped; this is platform telemetry
      type: "security.csp_violation",
      severity: "warning",
      source: "api",
      message:
        `CSP Report-Only: ${v.directiveName} would have blocked ${v.blockedOrigin}` +
        (v.documentPath ? ` on ${v.documentPath}` : "") +
        (count > 1 ? ` (${count} since last report)` : ""),
      context: {
        route: ROUTE_NAME,
        reason: v.directiveName, // machine-readable: which directive fired
        status: v.blockedOrigin, // where the blocked resource came from
        count,
      },
    });
  } catch {
    /* monitoring must never throw into a browser-driven report */
  }
}

export async function POST(request) {
  try {
    const payload = await request.json().catch(() => null);
    for (const report of extractReports(payload)) {
      const v = normalise(report);
      if (v) await record(v);
    }
  } catch {
    /* a malformed report is not worth a 4xx — the browser cannot act on it */
  }
  // 204 with no body: the browser ignores the response to a report POST.
  return new NextResponse(null, { status: 204 });
}
