import { NextResponse } from "next/server";
import { getAuthedOrg, getBearerToken, orgScopedClient, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { checkFeatureAccess } from "@/utils/entitlements";
import { loadReportDataForClient, defaultRange } from "@/utils/reportsData";

export const dynamic = "force-dynamic";

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const denied = requirePermission(auth, "report.view");
    if (denied) return denied;
    const feature = await checkFeatureAccess(serviceClient(), auth.orgId, "reports", "Reports");
    if (feature) return NextResponse.json(feature, { status: feature.status });
    const params = new URL(request.url).searchParams;
    const defaults = defaultRange();
    const range = { from: params.get("from") || defaults.from, to: params.get("to") || defaults.to };
    if (!validDate(range.from) || !validDate(range.to) || range.from > range.to) {
      return NextResponse.json({ error: "Choose a valid start and end date." }, { status: 400 });
    }
    // The plan check uses privileged billing access; report data deliberately
    // uses the caller's JWT so tenant, monitoring and history RLS still apply.
    const data = await loadReportDataForClient(range, orgScopedClient(getBearerToken(request)), auth.orgId);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Reports are temporarily unavailable. Please retry." }, { status: 503 });
  }
}
