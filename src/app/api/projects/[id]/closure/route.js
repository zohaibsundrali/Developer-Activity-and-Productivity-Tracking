import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
import { PROJECT_STATUS } from "@/utils/projectStatus";
import { settledFilter } from "@/utils/taskState";

export const dynamic = "force-dynamic";

/**
 * Closing a project — GET the readiness, POST the four steps.
 *
 * THREE SEPARATE WORDS, WHICH IS THE WHOLE POINT
 *
 *   completed_at          the project manager: the work is done
 *   client_signed_off_at  the client: we agree it is done
 *   closed_at             an administrator: the file is shut
 *
 * They are three timestamps rather than one status string because they are
 * three different people saying three different things, and the gap between
 * them is where a project quietly sits for a month. "Is this closed?" is
 * `closed_at is not null` — one question with one answer, whatever the status
 * text happens to say. See database/063_project_closure.sql.
 *
 * THE GATE
 *
 * `complete` is refused while any milestone is unfinished or any bug is open.
 * Not because the database says so — it does not, and deliberately: a gate in a
 * CHECK constraint would also block the data fixes and imports that have to be
 * able to say "this old project was finished in March". It is refused HERE, on
 * the one path a human takes, with the counts in the message so the answer to
 * "why can't I?" arrives with the refusal instead of after a hunt.
 *
 * GET returns those same counts so the screen can gray the button AND say why.
 * A disabled control with no explanation is the thing that gets reported as a
 * bug about the button.
 *
 * THE STATUS STRING IS WRITTEN, NEVER READ BACK. The route sets a matching
 * `status` alongside the timestamps so the existing badges keep working, and
 * decides nothing from it. That separation was originally forced — the app's
 * screens disagreed about the vocabulary — and it is kept now that migration
 * 065 has settled it, because a timestamp cannot be half-true and a text
 * column can. The values come from utils/projectStatus.js; 065's CHECK refuses
 * anything else, so a literal here would be a runtime failure.
 */

// Owner and admin can act on any project. A manager or team lead acts on the
// ones they run — see `mayManage` for why the null case is allowed.
const forbidden = (msg = "Your role cannot do that.") =>
  NextResponse.json({ error: msg }, { status: 403 });

/**
 * May this staff member act on this project?
 *
 * Owner and admin: always. Manager and team lead: when they are the project's
 * `manager_id` — OR when the project has no manager_id at all.
 *
 * That last clause is not a loophole, it is the state of the data. `manager_id`
 * is nullable and is empty on most existing projects, exactly as
 * `memberships.reports_to` is; if it were required, every project created
 * before it existed would have no one able to complete it and the feature
 * would read as broken. When a project HAS a manager, that manager is the one.
 */
function mayManage(auth, project) {
  // THE ROLE HALF ONLY. `project.complete` says the role may complete projects
  // at all; the `manager_id` comparison below says WHICH ones. Replacing the
  // whole function with a permission check would let every manager in the
  // organization complete every project, which is the widening this split
  // exists to prevent — see DELIBERATE_DIVERGENCES and the PR notes.
  if (!authCan(auth, "project.complete")) return false;
  if (["owner", "admin"].includes(auth.role)) return true;
  // The SUPERVISORS re-check that used to sit here is gone, not lost: the
  // authCan above admits exactly that set, so the line could never change an
  // answer. A guard no input can reach reads as load-bearing to whoever edits
  // it next.
  if (!project.manager_id) return true;
  return String(project.manager_id) === String(auth.appUserId);
}

/** Best effort — the closure is saved; failing to log it is not a failure. */
async function log(svc, { auth, project, action, meta }) {
  try {
    await svc.from("pm_activity").insert({
      organization_id: auth.orgId,
      project_id: project.id,
      entity_type: "project",
      entity_id: project.id,
      action,
      actor_id: auth.appUserId || null,
      meta: meta || {},
    });
  } catch {
    /* nobody is worse off for a missing activity row */
  }
}

/**
 * What stands between this project and "complete".
 *
 * Counted rather than fetched: the screen needs the numbers, not the rows, and
 * a project with 300 tasks should not ship 300 of them to answer "any bugs?".
 */
async function readGate(svc, orgId, projectId) {
  const [{ data: milestones }, { count: bugsOpen }] = await Promise.all([
    svc
      .from("milestones")
      .select("status")
      .eq("organization_id", orgId)
      .eq("project_id", projectId),
    svc
      .from("developer_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .eq("task_type", "bug")
      // UNSETTLED, not "off somebody's plate" — the two are different questions
      // and utils/taskState.js keeps them apart. A bug sitting with QA
      // (`reviewed`) still blocks closing the project, and so does one that
      // FAILED its retest (`rejected`). Only `completed` counts as done.
      //
      // The filter value is built from the same set the JS predicate uses, so
      // a change in one cannot leave this query asking the old question.
      .not("status", "in", settledFilter()),
  ]);

  const list = milestones || [];
  const milestonesOpen = list.filter((m) => m.status !== "completed").length;

  const reasons = [];
  if (milestonesOpen > 0) {
    reasons.push(
      `${milestonesOpen} of ${list.length} milestone${list.length === 1 ? "" : "s"} still open.`
    );
  }
  if (bugsOpen > 0) {
    reasons.push(`${bugsOpen} bug${bugsOpen === 1 ? "" : "s"} still open.`);
  }

  return {
    milestonesTotal: list.length,
    milestonesOpen,
    bugsOpen: bugsOpen || 0,
    ready: reasons.length === 0,
    reasons,
  };
}

/** Is this client on this project? */
async function clientIsOn(svc, auth, projectId) {
  const { data } = await svc
    .from("project_clients")
    .select("project_id")
    .eq("organization_id", auth.orgId)
    .eq("client_id", auth.appUserId)
    .eq("project_id", projectId)
    .maybeSingle();
  return Boolean(data);
}

const CLOSURE_COLUMNS =
  "id, name, status, manager_id, completed_at, completed_by, client_signed_off_at, " +
  "client_rating, client_feedback, closed_at, closed_by, closure_note";

export async function GET(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = serviceClient();
    // serviceClient bypasses RLS, so the organization filter here IS the tenant
    // boundary. It is not a hint.
    const { data: project } = await svc
      .from("projects")
      .select(CLOSURE_COLUMNS)
      .eq("id", params?.id)
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const isClient = auth.userType === "client";
    if (isClient && !(await clientIsOn(svc, auth, project.id))) {
      // 404 rather than 403: a client has no business learning that a project
      // they are not on exists.
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const gate = await readGate(svc, auth.orgId, project.id);
    const staffMayManage = mayManage(auth, project);
    const isAdmin = !isClient && ["owner", "admin"].includes(auth.role);

    return NextResponse.json({
      project,
      gate,
      can: {
        // Each of these is re-decided in POST against the same token. This
        // object shapes the screen; it does not permit anything.
        complete: staffMayManage && !project.completed_at && gate.ready,
        signOff: isClient && Boolean(project.completed_at) && !project.client_signed_off_at,
        close: isAdmin && Boolean(project.completed_at) && !project.closed_at,
        reopen: isAdmin && Boolean(project.closed_at),
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not read the closure state." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    const svc = serviceClient();
    const { data: project } = await svc
      .from("projects")
      .select(CLOSURE_COLUMNS)
      .eq("id", params?.id)
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const isClient = auth.userType === "client";
    if (isClient && !(await clientIsOn(svc, auth, project.id))) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const now = new Date().toISOString();
    let patch = null;
    let logEntry = null;

    switch (action) {
      // ── The work is done ──────────────────────────────────────────────
      case "complete": {
        if (!mayManage(auth, project)) return forbidden();
        if (project.completed_at) {
          return NextResponse.json(
            { error: "This project is already marked complete." },
            { status: 409 }
          );
        }

        // Re-read the gate here rather than trusting whatever GET told the
        // screen. A milestone can be reopened, or a bug filed, between the page
        // loading and the button being pressed.
        const gate = await readGate(svc, auth.orgId, project.id);
        if (!gate.ready) {
          return NextResponse.json(
            {
              error: "There is still open work on this project.",
              detail: gate.reasons.join(" "),
              gate,
            },
            { status: 409 }
          );
        }

        patch = {
          completed_at: now,
          completed_by: auth.appUserId || null,
          // Written for the badges that already read it. Nothing decides
          // anything from this string — see the note at the top.
          status: PROJECT_STATUS.completed,
        };
        logEntry = { action: "project_completed", meta: {} };
        break;
      }

      // ── The client agrees ─────────────────────────────────────────────
      case "sign_off": {
        // Staff cannot tick this on the client's behalf. The row would then
        // say the customer approved something they never saw, which is the one
        // claim in this whole flow that has to be theirs.
        if (!isClient) {
          return forbidden("Only the client can sign off a project.");
        }
        if (!project.completed_at) {
          return NextResponse.json(
            { error: "The team has not marked this project complete yet." },
            { status: 409 }
          );
        }
        if (project.client_signed_off_at) {
          return NextResponse.json({ error: "You have already signed this off." }, { status: 409 });
        }

        const rating = body.rating === null || body.rating === undefined ? null : Number(body.rating);
        if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
          return NextResponse.json(
            { error: "A rating is a whole number from 1 to 5." },
            { status: 400 }
          );
        }
        const feedback =
          typeof body.feedback === "string" ? body.feedback.trim().slice(0, 5000) : "";

        // The sign-off goes in the SAME patch as the rating. Split across two
        // writes, the rating would arrive at a row whose sign-off was still
        // null and the trigger would refuse it.
        patch = {
          client_signed_off_at: now,
          client_rating: rating,
          client_feedback: feedback || null,
        };
        logEntry = { action: "project_signed_off", meta: { rating } };
        break;
      }

      // ── The file is shut ──────────────────────────────────────────────
      case "close": {
        if (isClient || !["owner", "admin"].includes(auth.role)) {
          return forbidden("Only an owner or admin can close a project.");
        }
        if (!project.completed_at) {
          return NextResponse.json(
            { error: "Mark the work complete before closing the project." },
            { status: 409 }
          );
        }
        if (project.closed_at) {
          return NextResponse.json({ error: "This project is already closed." }, { status: 409 });
        }

        // Deliberately NOT gated on the client having signed off. Clients go
        // quiet, and a project the company has finished and been paid for
        // should not stay open forever waiting for a reply. The unsigned
        // closure is visible in the record, which is the honest version of it.
        patch = {
          closed_at: now,
          closed_by: auth.appUserId || null,
          closure_note:
            typeof body.note === "string" ? body.note.trim().slice(0, 5000) || null : null,
          status: PROJECT_STATUS.closed,
        };
        logEntry = {
          action: "project_closed",
          meta: { signedOff: Boolean(project.client_signed_off_at) },
        };
        break;
      }

      // ── Undo it ───────────────────────────────────────────────────────
      case "reopen": {
        if (isClient || !["owner", "admin"].includes(auth.role)) {
          return forbidden("Only an owner or admin can reopen a project.");
        }
        if (!project.closed_at) {
          return NextResponse.json({ error: "This project is not closed." }, { status: 409 });
        }

        // The trigger clears the sign-off, the completion, the rating and the
        // feedback on its own — a client who approved version one has not
        // approved whatever comes next. It is recorded here FIRST, because
        // after this update the only place that rating still exists is this
        // row in pm_activity.
        await log(svc, {
          auth,
          project,
          action: "project_reopened",
          meta: {
            clearedRating: project.client_rating,
            clearedFeedback: project.client_feedback,
            wasSignedOffAt: project.client_signed_off_at,
            wasCompletedAt: project.completed_at,
            wasClosedAt: project.closed_at,
          },
        });

        // `active`, not `in_progress`. They meant the same thing and that
        // duplication is what migration 065 removed; the CHECK now refuses
        // `in_progress`, so this write would fail. See utils/projectStatus.js.
        patch = { closed_at: null, closed_by: null, status: PROJECT_STATUS.active };
        // Already logged above, with the values that are about to be lost.
        logEntry = null;
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const { data: updated, error } = await svc
      .from("projects")
      .update(patch)
      .eq("id", project.id)
      .eq("organization_id", auth.orgId)
      .select(CLOSURE_COLUMNS)
      .maybeSingle();

    if (error) {
      // The trigger's messages are written to be read by a person, so they are
      // passed through rather than replaced with "something went wrong".
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (logEntry) await log(svc, { auth, project, ...logEntry });

    return NextResponse.json({ success: true, project: updated });
  } catch {
    return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
  }
}
