import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_BODY_LENGTH = 5000;

// Comment attachments live in the PRIVATE org-files bucket, under the same
// {organization_id}/{category}/... layout as every other org upload (migration
// 020 storage policies read that leading folder). The stored path never leaves
// the server: it is exchanged for a short-lived signed URL on every response.
const BUCKET = "org-files";
const ATTACHMENT_CATEGORY = "client-comments";
const SIGNED_URL_TTL = 10 * 60;

// A path is only accepted, and only ever signed, when it sits inside this
// org's client-comments folder. Without that check a caller could hand us any
// path in the bucket — including another organisation's folder — and be handed
// a signed URL for it.
function orgAttachmentPath(value, orgId) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.includes("..")) return null;
  return path.startsWith(`${orgId}/${ATTACHMENT_CATEGORY}/`) ? path : null;
}

// Mint signed URLs for the attachment paths of a batch of comment rows.
// Returns a Map of path -> signed URL; anything unsignable simply stays absent
// and the comment is returned with a null attachment_url.
async function signAttachments(svc, rows, orgId) {
  const paths = [];
  for (const row of rows) {
    const path = orgAttachmentPath(row.attachment_path, orgId);
    if (path && !paths.includes(path)) paths.push(path);
  }
  const signed = new Map();
  if (!paths.length) return signed;

  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  if (error) {
    console.error("[client/projects/:id/comments] Sign error:", error);
    return signed;
  }

  for (const entry of data || []) {
    if (entry?.path && entry?.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

// ClientComment. author_id / attachment_path are dropped here: the client gets
// a name and a signed URL, never an identity or a storage location.
function toClientComment(row, signedUrls, orgId) {
  const path = orgAttachmentPath(row.attachment_path, orgId);
  return {
    id: row.id,
    body: row.body,
    author_name: row.author_name || "Unknown",
    author_type: row.author_type === "client" ? "client" : "staff",
    attachment_name: row.attachment_name || null,
    attachment_url: (path && signedUrls.get(path)) || null,
    created_at: row.created_at,
  };
}

// GET /api/client/projects/[id]/comments?limit=&before=
// The project conversation, newest first, keyset-paged on `before`. Internal
// staff-only comments are excluded here and by RLS in migration 032.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params?.id;
    if (!clientCanAccessProject(auth, projectId)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    const requestedLimit = Number(searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const before = searchParams.get("before");
    if (before && Number.isNaN(Date.parse(before))) {
      return NextResponse.json(
        { success: false, error: "Invalid 'before' cursor" },
        { status: 400 }
      );
    }

    const svc = serviceClient();

    // One extra row answers hasMore without a second count query.
    let query = svc
      .from("project_comments")
      .select(
        "id, body, author_name, author_type, attachment_path, attachment_name, created_at"
      )
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("internal", false)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (before) query = query.lt("created_at", before);

    const { data: rows, error } = await query;

    if (error) {
      console.error("[client/projects/:id/comments] Query error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load comments" },
        { status: 500 }
      );
    }

    const page = (rows || []).slice(0, limit);
    const signedUrls = await signAttachments(svc, page, auth.orgId);

    return NextResponse.json({
      success: true,
      comments: page.map((row) => toClientComment(row, signedUrls, auth.orgId)),
      hasMore: (rows || []).length > limit,
    });
  } catch (err) {
    console.error("[client/projects/:id/comments] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/client/projects/[id]/comments
// Body: { body, attachment?: { path, name, type, size } }
// The author identity and `internal = false` are set from the verified session,
// never from the request: a client cannot post as staff or post an internal
// comment even by asking for one.
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params?.id;
    if (!clientCanAccessProject(auth, projectId)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!body) {
      return NextResponse.json(
        { success: false, error: "Comment body is required" },
        { status: 400 }
      );
    }
    if (body.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Comment must be ${MAX_BODY_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    // An attachment is optional, but a supplied one must already sit in this
    // org's client-comments folder — see orgAttachmentPath.
    const attachment = payload?.attachment;
    let attachmentPath = null;
    if (attachment) {
      attachmentPath = orgAttachmentPath(attachment.path, auth.orgId);
      if (!attachmentPath) {
        return NextResponse.json(
          { success: false, error: "Invalid attachment" },
          { status: 400 }
        );
      }
    }

    const size = Number(attachment?.size);
    const svc = serviceClient();

    // The display name comes from the client's own row, not from the request.
    const { data: client } = await svc
      .from("clients")
      .select("id, name")
      .eq("organization_id", auth.orgId)
      .eq("id", auth.clientId)
      .maybeSingle();

    const { data: inserted, error: insertError } = await svc
      .from("project_comments")
      .insert({
        organization_id: auth.orgId,
        project_id: projectId,
        author_id: auth.clientId,
        author_type: "client",
        author_name: client?.name || "Client",
        body,
        attachment_path: attachmentPath,
        attachment_name: attachmentPath
          ? (typeof attachment.name === "string" ? attachment.name : null)
          : null,
        attachment_type: attachmentPath
          ? (typeof attachment.type === "string" ? attachment.type : null)
          : null,
        attachment_size: attachmentPath && Number.isFinite(size) ? Math.trunc(size) : null,
        internal: false,
      })
      .select(
        "id, body, author_name, author_type, attachment_path, attachment_name, created_at"
      )
      .single();

    if (insertError || !inserted) {
      console.error("[client/projects/:id/comments] Insert error:", insertError);
      return NextResponse.json(
        { success: false, error: "Failed to post comment" },
        { status: 500 }
      );
    }

    const signedUrls = await signAttachments(svc, [inserted], auth.orgId);

    return NextResponse.json({
      success: true,
      comment: toClientComment(inserted, signedUrls, auth.orgId),
    });
  } catch (err) {
    console.error("[client/projects/:id/comments] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
