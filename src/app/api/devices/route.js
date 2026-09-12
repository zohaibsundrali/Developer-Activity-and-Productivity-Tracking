import { NextResponse } from "next/server";
import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";
const DEVICE_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function readCursor(value) {
  if (!value) return null;
  if (value.length > 500 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid cursor");
  const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!cursor || !UUID.test(cursor.id) || typeof cursor.created_at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.created_at)
      || !Number.isFinite(Date.parse(cursor.created_at))) throw new Error("Invalid cursor");
  return cursor;
}
function after(query, cursor) {
  return cursor ? query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`) : query;
}
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth || auth.userType === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let cursor;
    try { cursor = readCursor(new URL(request.url).searchParams.get("cursor")); }
    catch { return NextResponse.json({ error: "Invalid device cursor" }, { status: 400 }); }
    const client = orgScopedClient(auth.token);
    const query = () => client.from("tracker_devices").select("id,developer_id,name,platform,created_at,expires_at,revoked_at")
      .eq("organization_id", auth.orgId).order("created_at", { ascending: false }).order("id", { ascending: false });
    const { data, error } = await after(query(), cursor).limit(DEVICE_PAGE_SIZE);
    if (error) return NextResponse.json({ error: "Device list unavailable. Please retry." }, { status: 503 });
    const devices = data || [];
    const last = devices.at(-1);
    let hasMore = false;
    if (last) {
      // Probe after the actual last result. The hosted row cap may be smaller
      // than our requested page size; a short page is not proof of completion.
      const probe = await after(query(), last).limit(1);
      if (probe.error) return NextResponse.json({ error: "Device list unavailable. Please retry." }, { status: 503 });
      hasMore = Boolean(probe.data?.length);
    }
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ id: last.id, created_at: last.created_at })).toString("base64url") : null;
    return NextResponse.json({ devices, hasMore, nextCursor });
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
