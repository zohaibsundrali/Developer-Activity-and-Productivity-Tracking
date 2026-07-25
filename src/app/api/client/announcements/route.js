import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/client/announcements
// Org-wide (project_id null) or project-scoped announcements for the client's
// linked projects, newest published first.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();
    let query = svc
      .from("announcements")
      .select("id, project_id, title, body, author_name, published_at, created_at")
      .eq("organization_id", auth.orgId)
      .order("published_at", { ascending: false });

    // Org-wide announcements (null project) are always visible; project ones
    // only when the project is in the client's allowed set.
    if (auth.projectIds.length) {
      const list = auth.projectIds.map((id) => `"${id}"`).join(",");
      query = query.or(`project_id.is.null,project_id.in.(${list})`);
    } else {
      query = query.is("project_id", null);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[client/announcements] Query error:", error);
      return NextResponse.json({ error: "Failed to load announcements" }, { status: 500 });
    }

    return NextResponse.json({ announcements: data || [] });
  } catch (err) {
    console.error("[client/announcements] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
