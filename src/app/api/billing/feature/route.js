import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { checkFeatureAccess } from "@/utils/entitlements";

export const dynamic = "force-dynamic";
const FEATURES = { reports: "Reports", automation: "Automation", client_portal: "Client portal" };
export async function GET(request) {
  try {
  const auth = await getAuthedOrg(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const feature = new URL(request.url).searchParams.get("feature");
  if (!Object.hasOwn(FEATURES, feature)) return NextResponse.json({ error: "Unknown feature" }, { status: 400 });
  const refusal = await checkFeatureAccess(serviceClient(), auth.orgId, feature, FEATURES[feature]);
  if (refusal) return NextResponse.json(refusal, { status: refusal.status });
  return NextResponse.json({ allowed: true });
  } catch { return NextResponse.json({ error: "Service temporarily unavailable. Please retry." }, { status: 503 }); }
}
