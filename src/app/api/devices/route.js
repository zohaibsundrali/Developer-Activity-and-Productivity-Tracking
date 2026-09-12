import { NextResponse } from "next/server";
import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
  const auth = await getAuthedOrg(request);
  if (!auth || auth.userType === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await orgScopedClient(auth.token).from("tracker_devices")
    .select("id,developer_id,name,platform,created_at,expires_at,revoked_at")
    .eq("organization_id", auth.orgId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Device list unavailable. Please retry." }, { status: 503 });
  return NextResponse.json({ devices: data || [] });
  } catch { return NextResponse.json({ error: "Service temporarily unavailable. Please retry." }, { status: 503 }); }
}
export async function DELETE(request) {
  try {
  const auth = await getAuthedOrg(request);
  if (!auth || auth.userType === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = body && !Array.isArray(body) && typeof body === "object" ? body.id : null;
  if (typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Valid device id is required" }, { status: 400 });
  }
  const { data, error } = await orgScopedClient(auth.token).rpc("revoke_tracker_device", { p_id: id });
  if (error) return NextResponse.json({ error: "Device revocation unavailable. Please retry." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  return NextResponse.json({ revoked: true });
  } catch { return NextResponse.json({ error: "Device revocation unavailable. Please retry." }, { status: 503 }); }
}
