import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";
import { buildApproval } from "@/app/api/client/_lib/shapes";

export const dynamic = "force-dynamic";

// GET /api/client/approvals
// ClientApproval[] for the client's linked projects, newest first, each with
// its full decision `history` from approval_events (migration 032) — the
// approvals row itself keeps only the LAST decision.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!auth.projectIds.length) {
      return NextResponse.json({ success: true, approvals: [] });
    }

    const svc = serviceClient();
    const { data: approvals, error } = await svc
      .from("approvals")
      .select("id, project_id, item_type, title, description, status, created_at")
      .eq("organization_id", auth.orgId)
      .in("project_id", auth.projectIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[client/approvals] Query error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load approvals" },
        { status: 500 }
      );
    }

    if (!approvals?.length) {
      return NextResponse.json({ success: true, approvals: [] });
    }

    const { data: projects, error: projectsError } = await svc
      .from("projects")
      .select("id, name")
      .eq("organization_id", auth.orgId)
      .in("id", auth.projectIds);

    if (projectsError) {
      console.error("[client/approvals] Projects error:", projectsError);
      return NextResponse.json(
        { success: false, error: "Failed to load approvals" },
        { status: 500 }
      );
    }

    const { data: events, error: eventsError } = await svc
      .from("approval_events")
      .select("id, approval_id, action, note, actor_name, created_at")
      .eq("organization_id", auth.orgId)
      .in("approval_id", approvals.map((a) => a.id))
      .order("created_at", { ascending: false });

    if (eventsError) {
      console.error("[client/approvals] History error:", eventsError);
      return NextResponse.json(
        { success: false, error: "Failed to load approvals" },
        { status: 500 }
      );
    }

    const projectNames = new Map((projects || []).map((p) => [p.id, p.name]));

    // Events arrive newest-first, so each per-approval bucket keeps that order.
    const eventsByApproval = new Map();
    for (const e of events || []) {
      const list = eventsByApproval.get(e.approval_id) || [];
      list.push(e);
      eventsByApproval.set(e.approval_id, list);
    }

    return NextResponse.json({
      success: true,
      approvals: approvals.map((approval) =>
        buildApproval({
          approval,
          projectName: projectNames.get(approval.project_id),
          events: eventsByApproval.get(approval.id) || [],
        })
      ),
    });
  } catch (err) {
    console.error("[client/approvals] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
