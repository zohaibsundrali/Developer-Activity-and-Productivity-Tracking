import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/client/projects
// Returns the projects this client is linked to, scoped to their org.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // No linked projects => nothing to query.
    if (!auth.projectIds.length) {
      return NextResponse.json({ projects: [] });
    }

    const svc = serviceClient();
    const { data, error } = await svc
      .from("projects")
      .select("id, name, description, status, progress, deadline, created_at")
      .eq("organization_id", auth.orgId)
      .in("id", auth.projectIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[client/projects] Query error:", error);
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
    }

    return NextResponse.json({ projects: data || [] });
  } catch (err) {
    console.error("[client/projects] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
