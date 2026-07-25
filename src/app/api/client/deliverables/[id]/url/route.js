import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";
import { submissionPathFromUrl } from "@/utils/submissionFiles";

export const dynamic = "force-dynamic";

const BUCKET = "task-submissions";
const ONE_HOUR = 60 * 60;

// GET /api/client/deliverables/[id]/url
// Resolve a task-submission the client is allowed to see and return a
// short-lived signed URL for its private file.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deliverableId = params?.id;
    if (!deliverableId) {
      return NextResponse.json({ error: "Missing deliverable id" }, { status: 400 });
    }

    const svc = serviceClient();
    const { data: submission, error } = await svc
      .from("task_submissions")
      .select("id, project_id, file_url, storage_path")
      .eq("organization_id", auth.orgId)
      .eq("id", deliverableId)
      .single();

    if (error || !submission) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // The submission must belong to a project this client is linked to.
    if (!auth.projectIds.includes(submission.project_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const path = submission.storage_path || submissionPathFromUrl(submission.file_url);
    if (!path) {
      return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    }

    const { data: signed, error: signError } = await svc.storage
      .from(BUCKET)
      .createSignedUrl(path, ONE_HOUR);

    if (signError || !signed?.signedUrl) {
      console.error("[client/deliverables/:id/url] Sign error:", signError);
      return NextResponse.json({ error: "Failed to sign file" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (err) {
    console.error("[client/deliverables/:id/url] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
