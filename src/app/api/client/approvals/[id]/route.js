import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = new Set(["approved", "rejected"]);

// POST /api/client/approvals/[id]
// The client decides an approval item (approve / reject) for one of their
// linked projects. Clients may only write here and to support.
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const approvalId = params?.id;
    if (!approvalId) {
      return NextResponse.json({ error: "Missing approval id" }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const decision = body?.decision;
    const note = typeof body?.note === "string" ? body.note : null;

    if (!VALID_DECISIONS.has(decision)) {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    const svc = serviceClient();
    const { data: approval, error: fetchError } = await svc
      .from("approvals")
      .select("id, project_id")
      .eq("organization_id", auth.orgId)
      .eq("id", approvalId)
      .single();

    if (fetchError || !approval) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!clientCanAccessProject(auth, approval.project_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: updated, error: updateError } = await svc
      .from("approvals")
      .update({
        status: decision,
        decided_by: auth.clientId,
        decided_at: new Date().toISOString(),
        note,
      })
      .eq("id", approvalId)
      .eq("organization_id", auth.orgId)
      .select(
        "id, project_id, item_type, item_ref, title, description, status, decided_by, decided_at, note, created_at"
      )
      .single();

    if (updateError || !updated) {
      console.error("[client/approvals/:id] Update error:", updateError);
      return NextResponse.json({ error: "Failed to record decision" }, { status: 500 });
    }

    return NextResponse.json({ approval: updated });
  } catch (err) {
    console.error("[client/approvals/:id] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
