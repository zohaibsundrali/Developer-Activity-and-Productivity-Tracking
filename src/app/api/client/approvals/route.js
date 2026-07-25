import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/client/approvals
// Approval items for the client's linked projects, newest first.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!auth.projectIds.length) {
      return NextResponse.json({ approvals: [] });
    }

    const svc = serviceClient();
    const { data, error } = await svc
      .from("approvals")
      .select(
        "id, project_id, item_type, item_ref, title, description, status, decided_by, decided_at, note, created_at"
      )
      .eq("organization_id", auth.orgId)
      .in("project_id", auth.projectIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[client/approvals] Query error:", error);
      return NextResponse.json({ error: "Failed to load approvals" }, { status: 500 });
    }

    return NextResponse.json({ approvals: data || [] });
  } catch (err) {
    console.error("[client/approvals] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
