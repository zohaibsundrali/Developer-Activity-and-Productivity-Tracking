import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/recruitment — job openings and the hiring pipeline.
 *
 *   GET    ?view=openings | candidates&openingId=… | events&candidateId=…
 *   POST   ?action=opening | candidate
 *   PATCH  move a candidate, or change an opening's status
 *
 * CANDIDATES ARE THE MOST SENSITIVE ROWS IN THIS PRODUCT. A candidate is a
 * named person outside the organization who never agreed to be discussed in
 * it — their email, their phone, their CV, somebody's private opinion of them.
 * So reading them is owner/admin/hr, with ONE exception granted on the row
 * rather than on a key: whoever is named `hiring_manager_id` on the opening can
 * read that opening's candidates and nobody else's. `canSeeCandidates()` below
 * is that rule, and the RLS policy in 085 carries it independently.
 *
 * EVERY MOVE IS RECORDED. A stage change writes a `candidate_events` row with
 * who did it — the pipeline is the point of an ATS, and a stage column with no
 * history can only ever say where somebody is, never how long they have been
 * there or where everybody else fell out.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAGES = ["applied", "screening", "interview", "offer", "hired"];
const OUTCOMES = ["rejected", "withdrawn", "hired"];
const OPENING_STATUS = ["draft", "open", "on_hold", "closed", "filled"];

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/**
 * May this caller read the candidates on this opening?
 *
 * Two ways in, and the second is a fact about the row. Returns the opening as
 * well, because every caller needs it and re-fetching would be a second query
 * for an answer already in hand.
 */
async function openingIfVisible(svc, auth, openingId) {
  const { data: opening } = await svc
    .from("job_openings")
    .select("*")
    .eq("organization_id", auth.orgId)
    .eq("id", openingId)
    .maybeSingle();
  if (!opening) return { opening: null, canSee: false };
  const canSee =
    authCan(auth, "candidate.view") ||
    String(opening.hiring_manager_id || "") === String(auth.appUserId);
  return { opening, canSee };
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "openings";
    const svc = serviceClient();

    if (view === "openings") {
      const denied = requirePermission(auth, "job.view");
      if (denied) return denied;
      const { data, error } = await svc
        .from("job_opening_pipeline_v")
        .select("*")
        .eq("organization_id", auth.orgId)
        .order("title")
        .limit(300);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, openings: data || [] });
    }

    if (view === "candidates") {
      const openingId = searchParams.get("openingId");
      if (!UUID_RE.test(String(openingId || ""))) {
        return NextResponse.json({ success: false, error: "Invalid openingId" }, { status: 400 });
      }
      // job.view first: somebody who cannot see openings at all has no business
      // learning that this id exists.
      const denied = requirePermission(auth, "job.view");
      if (denied) return denied;

      const { opening, canSee } = await openingIfVisible(svc, auth, openingId);
      if (!opening) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
      }
      if (!canSee) {
        return NextResponse.json(
          { success: false, error: "You can see this opening but not its applicants" },
          { status: 403 }
        );
      }

      const { data, error } = await svc
        .from("candidates")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("job_opening_id", openingId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, opening, candidates: data || [] });
    }

    // events
    const candidateId = searchParams.get("candidateId");
    if (!UUID_RE.test(String(candidateId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid candidateId" }, { status: 400 });
    }
    const deniedEv = requirePermission(auth, "job.view");
    if (deniedEv) return deniedEv;

    const { data: candidate } = await svc
      .from("candidates")
      .select("id, job_opening_id")
      .eq("organization_id", auth.orgId)
      .eq("id", candidateId)
      .maybeSingle();
    if (!candidate) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    const { canSee } = await openingIfVisible(svc, auth, candidate.job_opening_id);
    if (!canSee) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await svc
      .from("candidate_events")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, events: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load recruitment data" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "opening";
    const keyFor = { opening: "job.manage", candidate: "candidate.manage" };
    if (!keyFor[action]) {
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }
    const denied = requirePermission(auth, keyFor[action]);
    if (denied) return denied;

    const svc = serviceClient();
    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const body = await request.json().catch(() => ({}));

    if (action === "opening") {
      const title = clip(body?.title, 200);
      if (!title) {
        return NextResponse.json({ success: false, error: "Give the opening a title" }, { status: 400 });
      }
      const count = Number(body?.openingsCount);
      const { data, error } = await svc
        .from("job_openings")
        .insert({
          organization_id: auth.orgId,
          title,
          description: clip(body?.description, 20000),
          location: clip(body?.location, 200),
          employment_type: ["full_time", "part_time", "contract", "intern"].includes(
            body?.employmentType
          )
            ? body.employmentType
            : null,
          target_role: clip(body?.targetRole, 40),
          hiring_manager_id: UUID_RE.test(String(body?.hiringManagerId || ""))
            ? body.hiringManagerId
            : null,
          openings_count: Number.isInteger(count) && count >= 1 ? count : 1,
          status: OPENING_STATUS.includes(body?.status) ? body.status : "draft",
          created_by: auth.appUserId,
        })
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, opening: data });
    }

    // action === "candidate"
    const { openingId, fullName, email } = body || {};
    if (!UUID_RE.test(String(openingId || ""))) {
      return NextResponse.json({ success: false, error: "Choose an opening" }, { status: 400 });
    }
    const name = clip(fullName, 200);
    if (!name) {
      return NextResponse.json({ success: false, error: "Give the candidate a name" }, { status: 400 });
    }
    if (!EMAIL_RE.test(String(email || ""))) {
      return NextResponse.json({ success: false, error: "That is not an email address" }, { status: 400 });
    }

    const { data: opening } = await svc
      .from("job_openings")
      .select("id, status")
      .eq("organization_id", auth.orgId)
      .eq("id", openingId)
      .maybeSingle();
    if (!opening) {
      return NextResponse.json({ success: false, error: "Opening not found" }, { status: 404 });
    }
    if (["closed", "filled"].includes(opening.status)) {
      return NextResponse.json(
        { success: false, error: `That opening is ${opening.status}` },
        { status: 409 }
      );
    }

    const { data: candidate, error } = await svc
      .from("candidates")
      .insert({
        organization_id: auth.orgId,
        job_opening_id: openingId,
        full_name: name,
        // The trigger in 085 lower-cases this; sending it normalised too means
        // the value that comes back matches what was sent.
        email: String(email).trim().toLowerCase(),
        phone: clip(body?.phone, 60),
        resume_url: clip(body?.resumeUrl, 2000),
        source: clip(body?.source, 100),
        notes: clip(body?.notes, 20000),
        created_by: auth.appUserId,
      })
      .select()
      .single();

    if (error) {
      const dup = /candidates_one_per_opening/i.test(error.message || "");
      return NextResponse.json(
        {
          success: false,
          error: dup ? "Somebody with that email has already applied for this opening" : error.message,
        },
        { status: dup ? 409 : 500 }
      );
    }

    await svc.from("candidate_events").insert({
      organization_id: auth.orgId,
      candidate_id: candidate.id,
      to_stage: "applied",
      note: "Applied",
      actor_user_id: auth.appUserId,
    });

    return NextResponse.json({ success: true, candidate });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not save that" },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const svc = serviceClient();
    const now = new Date().toISOString();

    if (body?.openingId && body?.status) {
      const denied = requirePermission(auth, "job.manage");
      if (denied) return denied;
      if (!UUID_RE.test(String(body.openingId)) || !OPENING_STATUS.includes(body.status)) {
        return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
      }
      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      const { data, error } = await svc
        .from("job_openings")
        .update({ status: body.status, updated_at: now })
        .eq("organization_id", auth.orgId)
        .eq("id", body.openingId)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, opening: data });
    }

    const { candidateId, stage, outcome, note } = body || {};
    if (!UUID_RE.test(String(candidateId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid candidateId" }, { status: 400 });
    }
    const denied = requirePermission(auth, "candidate.manage");
    if (denied) return denied;

    const movingStage = stage !== undefined && stage !== null;
    const settingOutcome = outcome !== undefined;
    if (movingStage && !STAGES.includes(stage)) {
      return NextResponse.json({ success: false, error: "Invalid stage" }, { status: 400 });
    }
    if (settingOutcome && outcome !== null && !OUTCOMES.includes(outcome)) {
      return NextResponse.json({ success: false, error: "Invalid outcome" }, { status: 400 });
    }
    if (!movingStage && !settingOutcome) {
      return NextResponse.json({ success: false, error: "Nothing to change" }, { status: 400 });
    }

    const { data: existing } = await svc
      .from("candidates")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", candidateId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const patch = { updated_at: now };
    if (movingStage) patch.stage = stage;
    if (settingOutcome) patch.outcome = outcome;
    // 'hired' is the one outcome that also fixes the stage — somebody hired is
    // at the end of the pipeline by definition, and leaving the stage wherever
    // it happened to be would make the funnel counts wrong.
    if (outcome === "hired") patch.stage = "hired";

    const { data, error } = await svc
      .from("candidates")
      .update(patch)
      .eq("id", candidateId)
      .select()
      .single();

    if (error) {
      const final = /already/i.test(error.message || "") && /Clear the outcome/i.test(error.message || "");
      return NextResponse.json(
        {
          success: false,
          error: final
            ? `That candidate is already ${existing.outcome}. Clear the outcome before moving them again.`
            : error.message,
        },
        { status: final ? 409 : 500 }
      );
    }

    // EVERY MOVE IS RECORDED. See the note at the top.
    await svc.from("candidate_events").insert({
      organization_id: auth.orgId,
      candidate_id: candidateId,
      from_stage: existing.stage,
      to_stage: data.stage,
      outcome: data.outcome,
      note: clip(note, 4000),
      actor_user_id: auth.appUserId,
    });

    return NextResponse.json({ success: true, candidate: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not update that" },
      { status: 500 }
    );
  }
}
