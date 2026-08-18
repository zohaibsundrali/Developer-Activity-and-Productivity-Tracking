import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
import { defaultRolesFor } from "@/utils/permissionCatalogue";

export const dynamic = "force-dynamic";

/**
 * /api/change-requests
 *
 *   GET   list. Clients see their own projects'; staff see the organization's.
 *   POST  raise one. Clients on their own projects; owner/admin/manager anywhere.
 *
 * `pm_notes` IS STRIPPED FOR CLIENTS HERE.
 *
 * That is not a detail — it is the one rule RLS cannot express. Row Level
 * Security is row-level: the client_read policy in database/060 correctly
 * grants the whole ROW, and there is no way to say "except this column". So
 * the internal notes — where "they will not like the price" and "we
 * underquoted the original" get written — are removed in this route.
 *
 * Which means the route is load-bearing for that one field, unlike the
 * organization scoping around it. A client reading `change_requests` directly
 * through PostgREST would see pm_notes. That is worth knowing rather than
 * discovering; the honest fix is a view or a column-level grant, and both are
 * a bigger change than this feature justifies today.
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 10000;

const CLIENT_SAFE = (row) => {
  const { pm_notes, ...rest } = row;
  return rest;
};

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = serviceClient();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");

    let q = svc
      .from("change_requests")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (projectId) q = q.eq("project_id", projectId);

    const isClient = auth.userType === "client";
    if (isClient) {
      // The service client bypasses RLS, so the route re-applies the scope the
      // policy would have. Without this a client sees every project's changes.
      const { data: links } = await svc
        .from("project_clients")
        .select("project_id")
        .eq("organization_id", auth.orgId)
        .eq("client_id", auth.appUserId);
      const ids = (links || []).map((l) => l.project_id);
      if (!ids.length) return NextResponse.json({ changeRequests: [] });
      q = q.in("project_id", ids);
    }

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({
      changeRequests: isClient ? (data || []).map(CLIENT_SAFE) : data || [],
    });
  } catch (e) {
    console.error("[change-requests GET]", e?.message || e);
    return NextResponse.json({ error: "Could not load change requests." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = body.projectId;
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();

    if (!projectId || !title || !description) {
      return NextResponse.json(
        { error: "A project, a title and a description are all required." },
        { status: 400 }
      );
    }
    if (title.length > MAX_TITLE || description.length > MAX_DESCRIPTION) {
      return NextResponse.json({ error: "That is longer than we can store." }, { status: 400 });
    }

    const svc = serviceClient();
    const isClient = auth.userType === "client";

    if (isClient) {
      // A client raises one only against a project it is actually on.
      const { data: link } = await svc
        .from("project_clients")
        .select("project_id")
        .eq("organization_id", auth.orgId)
        .eq("client_id", auth.appUserId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (!link) {
        return NextResponse.json({ error: "That is not one of your projects." }, { status: 403 });
      }
    } else if (!authCan(auth, "change_request.create")) {
      return NextResponse.json(
        { error: "Your role cannot raise a change request." },
        { status: 403 }
      );
    } else {
      const { data: project } = await svc
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("organization_id", auth.orgId)
        .maybeSingle();
      if (!project) {
        return NextResponse.json({ error: "Unknown project." }, { status: 404 });
      }
    }

    const { data, error } = await svc
      .from("change_requests")
      .insert({
        organization_id: auth.orgId,
        project_id: projectId,
        title,
        description,
        requester_type: isClient ? "client" : "staff",
        requested_by: auth.appUserId || null,
        status: "submitted",
      })
      .select()
      .single();

    if (error) throw error;

    // Tell the people who will have to price it. Best-effort.
    try {
      const { data: staff } = await svc
        .from("memberships")
        .select("user_id, email, user_type, role")
        .eq("organization_id", auth.orgId)
        .eq("status", "active")
        // Not a guard — this asks WHO TO NOTIFY, and the answer is the same
        // set that may raise one. Derived from the catalogue so the notify
        // list cannot drift from the permission the way the old copy could.
        .in("role", [...defaultRolesFor("change_request.create")]);

      const rows = (staff || []).map((m) => ({
        organization_id: auth.orgId,
        admin_id: m.user_type === "admin" ? m.user_id : null,
        developer_id: m.user_type === "developer" ? m.user_id : null,
        admin_email: m.email || null,
        type: "change_request_raised",
        category: "project",
        title: "New change request",
        message: `"${title}" needs an estimate.`,
        entity_type: "change_request",
        entity_id: data.id,
        project_id: projectId,
        read: false,
      }));
      if (rows.length) await svc.from("notifications").insert(rows);
    } catch (notifyErr) {
      console.error("[change-requests POST] notify failed:", notifyErr?.message || notifyErr);
    }

    return NextResponse.json(
      { changeRequest: isClient ? CLIENT_SAFE(data) : data },
      { status: 201 }
    );
  } catch (e) {
    console.error("[change-requests POST]", e?.message || e);
    return NextResponse.json({ error: "Could not raise that change request." }, { status: 503 });
  }
}
