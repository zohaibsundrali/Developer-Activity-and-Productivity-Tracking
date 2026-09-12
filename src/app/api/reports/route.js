import { NextResponse } from "next/server";
import { getAuthedOrg, getBearerToken, orgScopedClient, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { checkFeatureAccess } from "@/utils/entitlements";
import { loadReportDataForClient, defaultRange } from "@/utils/reportsData";

import { reportRangeBounds } from "@/utils/reportDates";

export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" } });
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const denied = requirePermission(auth, "report.view");
    if (denied) {
      const headers = new Headers(denied.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Vary", "Authorization, Cookie");
      return new NextResponse(denied.body, { status: denied.status, headers });
    }
    const feature = await checkFeatureAccess(serviceClient(), auth.orgId, "reports", "Reports");
    if (feature) return json(feature, feature.status);
    const params = new URL(request.url).searchParams;
    const defaults = defaultRange();
    const range = { from: params.get("from") ?? defaults.from, to: params.get("to") ?? defaults.to };
    try { reportRangeBounds(range); }
    catch (error) { return json({ error: error.message || "Choose a valid start and end date." }, 400); }
    // The plan check uses privileged billing access; report data deliberately
    // uses the caller's JWT so tenant, monitoring and history RLS still apply.
    const data = await loadReportDataForClient(range, orgScopedClient(getBearerToken(request)), auth.orgId);
    if (!data || data.orgId !== auth.orgId || data.range?.from !== range.from || data.range?.to !== range.to
      || !["projects", "tasks", "employees", "timeLogs", "sessions"].every(key => Array.isArray(data[key]))
      || !data.truncated || typeof data.truncated !== "object"
      || !["projects", "tasks", "employees", "timeLogs", "sessions"].every(key => typeof data.truncated[key] === "boolean")
      || Object.values(data.truncated).some(value => typeof value !== "boolean")) {
      return json({ error: "Could not confirm the report. Please retry." }, 503);
    }
    if (Object.values(data.truncated).some(Boolean)) {
      return json({ error: "This report exceeds the current processing limit. Narrow the date range where applicable; no partial totals were returned." }, 413);
    }
    return json(data);
  } catch {
    return json({ error: "Reports are temporarily unavailable. Please retry." }, 503);
  }
}
