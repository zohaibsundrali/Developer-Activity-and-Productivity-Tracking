import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/performance — review cycles, reviews, and goals.
 *
 *   GET    ?view=cycles | reviews&cycleId=… | mine
 *   POST   ?action=cycle | review | goal
 *   PATCH  submit or share a review, close a cycle, or move a goal
 *
 * A REVIEW IS PRIVATE UNTIL IT IS SHARED. The `mine` view returns only reviews
 * whose status is 'shared', and the RLS policy in 083 says the same thing
 * independently — a half-written assessment is not feedback, it is a draft
 * somebody would edit if they knew it was being read.
 *
 * THE REVIEWER IS ALWAYS THE CALLER. `reviewerUserId` is not read from the body
 * anywhere in this file. Writing a review under somebody else's name is the one
 * thing that would make "who said this" unanswerable, and the CHECK in 083
 * refuses self-review underneath.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GOAL_STATUS = ["open", "met", "missed", "dropped"];

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (v) => typeof v === "string" && DATE_RE.test(v);

/** The target must be in this organization, or an id from anywhere would do. */
async function memberExists(svc, orgId, userId) {
  const { data } = await svc
    .from("memberships")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "cycles";
    const svc = serviceClient();

    if (view === "mine") {
      // Everybody may read their OWN shared review and their own goals.
      const denied = requirePermission(auth, "review.view_own");
      if (denied) return denied;

      const [{ data: reviews }, { data: goals }] = await Promise.all([
        svc
          .from("performance_reviews")
          .select("*, review_cycles(name, period_start, period_end)")
          .eq("organization_id", auth.orgId)
          .eq("subject_user_id", auth.appUserId)
          // SHARED ONLY. See the note at the top of this file.
          .eq("status", "shared")
          .order("shared_at", { ascending: false })
          .limit(100),
        svc
          .from("performance_goals")
          .select("*")
          .eq("organization_id", auth.orgId)
          .eq("user_id", auth.appUserId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      return NextResponse.json({ success: true, reviews: reviews || [], goals: goals || [] });
    }

    if (view === "reviews") {
      // Reading everybody's reviews is HR's; a reviewer reads their own on
      // authorship, which RLS grants and this route mirrors.
      const canReadAll = authCan(auth, "review.view_all");
      if (!canReadAll && !authCan(auth, "review.write")) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
      }
      const cycleId = searchParams.get("cycleId");
      if (!UUID_RE.test(String(cycleId || ""))) {
        return NextResponse.json({ success: false, error: "Invalid cycleId" }, { status: 400 });
      }
      let q = svc
        .from("performance_reviews")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("cycle_id", cycleId)
        .limit(1000);
      if (!canReadAll) q = q.eq("reviewer_user_id", auth.appUserId);
      const { data, error } = await q;
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, reviews: data || [] });
    }

    // Cycles are readable by anyone who may write or run a review — knowing a
    // period is open is not confidential.
    if (!authCan(auth, "review.write") && !authCan(auth, "review_cycle.manage")) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const { data, error } = await svc
      .from("review_cycle_summary_v")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("period_end", { ascending: false })
      .limit(100);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, cycles: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load performance data" },
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
    const action = searchParams.get("action") || "cycle";
    const keyFor = {
      cycle: "review_cycle.manage",
      review: "review.write",
      goal: "goal.manage",
    };
    if (!keyFor[action]) {
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }
    const denied = requirePermission(auth, keyFor[action]);
    if (denied) return denied;

    const svc = serviceClient();
    const billingBlocked = await requireUnlocked(svc, auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const body = await request.json().catch(() => ({}));

    if (action === "cycle") {
      const name = clip(body?.name, 200);
      if (!name) {
        return NextResponse.json({ success: false, error: "Name the cycle" }, { status: 400 });
      }
      if (!isDate(body?.periodStart) || !isDate(body?.periodEnd)) {
        return NextResponse.json(
          { success: false, error: "Dates must be YYYY-MM-DD" },
          { status: 400 }
        );
      }
      if (body.periodEnd < body.periodStart) {
        return NextResponse.json(
          { success: false, error: "The period ends before it starts" },
          { status: 400 }
        );
      }
      const { data, error } = await svc
        .from("review_cycles")
        .insert({
          organization_id: auth.orgId,
          name,
          period_start: body.periodStart,
          period_end: body.periodEnd,
          status: body?.status === "open" ? "open" : "draft",
          created_by: auth.appUserId,
        })
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, cycle: data });
    }

    if (action === "review") {
      const { cycleId, subjectUserId } = body || {};
      if (!UUID_RE.test(String(cycleId || "")) || !UUID_RE.test(String(subjectUserId || ""))) {
        return NextResponse.json({ success: false, error: "Invalid ids" }, { status: 400 });
      }
      // NOT read from the body. See the note at the top.
      const reviewerUserId = auth.appUserId;
      if (String(subjectUserId) === String(reviewerUserId)) {
        // The CHECK in 083 refuses this too; answering here gives the reason
        // rather than a constraint name.
        return NextResponse.json(
          { success: false, error: "You cannot review yourself" },
          { status: 409 }
        );
      }

      const { data: cycle } = await svc
        .from("review_cycles")
        .select("id, status")
        .eq("organization_id", auth.orgId)
        .eq("id", cycleId)
        .maybeSingle();
      if (!cycle) {
        return NextResponse.json({ success: false, error: "Cycle not found" }, { status: 404 });
      }
      if (cycle.status !== "open") {
        return NextResponse.json(
          { success: false, error: `That cycle is ${cycle.status}, not open for reviews` },
          { status: 409 }
        );
      }
      if (!(await memberExists(svc, auth.orgId, subjectUserId))) {
        return NextResponse.json(
          { success: false, error: "That person is not in this organization" },
          { status: 404 }
        );
      }

      const rating = Number(body?.rating);
      const { data, error } = await svc
        .from("performance_reviews")
        .insert({
          organization_id: auth.orgId,
          cycle_id: cycleId,
          subject_user_id: subjectUserId,
          reviewer_user_id: reviewerUserId,
          // Null unless a real 1..5 arrived. See 083: an unchosen 3 averages
          // into every report as if it meant something.
          rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
          strengths: clip(body?.strengths, 8000),
          improvements: clip(body?.improvements, 8000),
          status: "draft",
        })
        .select()
        .single();
      if (error) {
        const dup = /review_one_per_reviewer/i.test(error.message || "");
        return NextResponse.json(
          {
            success: false,
            error: dup ? "You have already started a review for that person in this cycle" : error.message,
          },
          { status: dup ? 409 : 500 }
        );
      }
      return NextResponse.json({ success: true, review: data });
    }

    // action === "goal"
    const { userId, title } = body || {};
    if (!UUID_RE.test(String(userId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 });
    }
    const goalTitle = clip(title, 300);
    if (!goalTitle) {
      return NextResponse.json({ success: false, error: "Give the goal a title" }, { status: 400 });
    }
    if (!(await memberExists(svc, auth.orgId, userId))) {
      return NextResponse.json(
        { success: false, error: "That person is not in this organization" },
        { status: 404 }
      );
    }
    const { data, error } = await svc
      .from("performance_goals")
      .insert({
        organization_id: auth.orgId,
        cycle_id: UUID_RE.test(String(body?.cycleId || "")) ? body.cycleId : null,
        user_id: userId,
        title: goalTitle,
        description: clip(body?.description, 8000),
        due_date: isDate(body?.dueDate) ? body.dueDate : null,
        created_by: auth.appUserId,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, goal: data });
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

    if (body?.cycleId && body?.status) {
      const denied = requirePermission(auth, "review_cycle.manage");
      if (denied) return denied;
      if (!UUID_RE.test(String(body.cycleId)) || !["draft", "open", "closed"].includes(body.status)) {
        return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
      }
      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      const { data, error } = await svc
        .from("review_cycles")
        .update({ status: body.status, updated_at: now })
        .eq("organization_id", auth.orgId)
        .eq("id", body.cycleId)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, cycle: data });
    }

    if (body?.goalId) {
      const denied = requirePermission(auth, "goal.manage");
      if (denied) return denied;
      if (!UUID_RE.test(String(body.goalId)) || !GOAL_STATUS.includes(body?.status)) {
        return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
      }
      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      const { data, error } = await svc
        .from("performance_goals")
        .update({ status: body.status, updated_at: now })
        .eq("organization_id", auth.orgId)
        .eq("id", body.goalId)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, goal: data });
    }

    const { reviewId, action } = body || {};
    if (!UUID_RE.test(String(reviewId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid reviewId" }, { status: 400 });
    }
    if (!["submit", "share"].includes(action)) {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    }

    const { data: existing } = await svc
      .from("performance_reviews")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", reviewId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    if (action === "submit") {
      // Finishing your own review needs review.write and authorship. HR
      // submitting somebody else's draft would be putting words in their mouth.
      const denied = requirePermission(auth, "review.write");
      if (denied) return denied;
      if (String(existing.reviewer_user_id) !== String(auth.appUserId)) {
        return NextResponse.json(
          { success: false, error: "Only the reviewer may submit their own review" },
          { status: 403 }
        );
      }
      if (existing.status !== "draft") {
        return NextResponse.json(
          { success: false, error: `That review is already ${existing.status}` },
          { status: 409 }
        );
      }
    } else {
      // SHARING IS HR'S DECISION, not the reviewer's — it is the moment the
      // subject gains the right to read it.
      const denied = requirePermission(auth, "review.view_all");
      if (denied) return denied;
      if (existing.status !== "submitted") {
        return NextResponse.json(
          { success: false, error: "Only a submitted review can be shared" },
          { status: 409 }
        );
      }
    }

    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const patch =
      action === "submit"
        ? {
            status: "submitted",
            submitted_at: now,
            updated_at: now,
            rating: Number.isInteger(Number(body?.rating)) && Number(body.rating) >= 1 && Number(body.rating) <= 5
              ? Number(body.rating)
              : existing.rating,
            strengths: body?.strengths !== undefined ? clip(body.strengths, 8000) : existing.strengths,
            improvements:
              body?.improvements !== undefined ? clip(body.improvements, 8000) : existing.improvements,
          }
        : { status: "shared", shared_at: now, updated_at: now };

    const { data, error } = await svc
      .from("performance_reviews")
      .update(patch)
      .eq("id", reviewId)
      .select()
      .single();

    if (error) {
      const closed = /review cycle is closed/i.test(error.message || "");
      return NextResponse.json(
        { success: false, error: closed ? "That review cycle is closed. Reopen it first." : error.message },
        { status: closed ? 409 : 500 }
      );
    }
    return NextResponse.json({ success: true, review: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not update that" },
      { status: 500 }
    );
  }
}
