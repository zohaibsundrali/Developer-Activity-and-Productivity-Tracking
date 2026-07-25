import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/client/invoices
// Non-draft invoices addressed to this client, newest issued first.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();
    const { data, error } = await svc
      .from("invoices")
      .select(
        "id, project_id, client_id, number, title, amount, currency, status, issued_at, due_at, notes, created_at"
      )
      .eq("organization_id", auth.orgId)
      .eq("client_id", auth.clientId)
      .neq("status", "draft")
      .order("issued_at", { ascending: false });

    if (error) {
      console.error("[client/invoices] Query error:", error);
      return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
    }

    return NextResponse.json({ invoices: data || [] });
  } catch (err) {
    console.error("[client/invoices] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
