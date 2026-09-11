import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/quality — test cases, test runs, and the defect link.
 *
 *   GET    ?view=cases | runs | run&runId=…
 *   POST   ?action=case | run | bug
 *   PATCH  record a result, or close/reopen a run.
 *
 * A DEFECT IS STILL A developer_tasks ROW. Migration 061 refused a second bug
 * pipeline and its reasoning holds, so `?action=bug` writes exactly the row the
 * Bug Queue writes — `task_type: 'bug'`, same statuses, same board — and then
 * points the execution at it. Nothing here is a parallel lifecycle.
 *
 * ONE DIFFERENCE, STATED RATHER THAN HIDDEN: the Bug Queue goes through
 * `createTask`, which fires `task_created` automations. That helper uses the
 * browser Supabase client and reads the organization from sessionStorage, so it
 * cannot run here, and a defect raised from a failed test does NOT currently
 * trigger those automations. The row itself is identical; only the side effect
 * is missing. Worth fixing by moving automation dispatch server-side, which is
 * a larger change than this feature, so it is written down instead of assumed
 * away.
 *
 * OPENING A RUN WRITES ITS SCOPE. Every active case in the project gets an
 * 'untested' execution at the moment the run starts. A run whose rows appear
 * only as they are executed cannot tell anybody what is left to do, which is
 * the one question a run exists to answer.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULTS = ["untested", "passed", "failed", "blocked", "skipped"];
const SEVERITIES = ["critical", "major", "minor", "trivial"];
const MAX_CASES_PER_RUN = 500;

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

function qualityTransactionError(error) {
  const message = error?.message || '';
  const status = error?.code === '42501' ? 403 : error?.code === 'P0002' ? 404 :
    ['22023', '22P02'].includes(error?.code) ? 400 : message.startsWith('QA_CONFLICT:') ? 409 :
    /^(BILLING_LOCKED|PLAN_LIMIT_REACHED):/.test(message) ? 402 : 503;
  return NextResponse.json({ success: false, error: status === 503 ? 'Could not save the QA workflow. Please retry.' :
    message.split(':').slice(1).join(':').trim() || 'QA workflow refused' }, { status });
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const denied = requirePermission(auth, "test_case.view");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "cases";
    const projectId = searchParams.get("projectId");
    if (projectId && !UUID_RE.test(projectId)) {
      return NextResponse.json({ success: false, error: "Invalid projectId" }, { status: 400 });
    }
    const svc = serviceClient();

    if (view === "runs") {
      let q = svc
        .from("test_run_summary_v")
        .select("*")
        .eq("organization_id", auth.orgId)
        .order("started_at", { ascending: false })
        .limit(200);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, runs: data || [] });
    }

    if (view === "run") {
      const runId = searchParams.get("runId");
      if (!UUID_RE.test(String(runId || ""))) {
        return NextResponse.json({ success: false, error: "Invalid runId" }, { status: 400 });
      }
      // The run is fetched scoped to the org before anything hangs off it, so a
      // run id from another tenant answers 404 rather than leaking its shape.
      const { data: run } = await svc
        .from("test_runs")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("id", runId)
        .maybeSingle();
      if (!run) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
      }
      const { data: executions, error } = await svc
        .from("test_executions")
        .select("*, test_cases(id, title, priority, steps, expected_result)")
        .eq("organization_id", auth.orgId)
        .eq("run_id", runId)
        .limit(MAX_CASES_PER_RUN);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, run, executions: executions || [] });
    }

    let q = svc
      .from("test_cases")
      .select("*")
      .eq("organization_id", auth.orgId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (projectId) q = q.eq("project_id", projectId);
    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, cases: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load quality data" },
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
    const action = searchParams.get("action") || "case";

    // Three different acts, three different keys. Writing a case is a QA
    // decision; running a test and filing what it found are two more.
    //
    // `bug` USED TO ASK `test_run.execute`, on the reasoning that anybody
    // running the test may file what it found. That held while execute meant
    // REVIEWERS. It no longer does: execute is now TESTERS, so developer,
    // designer, devops and employee can record a result — and filing a defect
    // writes a `developer_tasks` row, which is task creation, which is
    // SUPERVISORS everywhere else in the product. `bug.raise` holds exactly
    // the roles execute held before, so this line changes nothing for anybody
    // today; it stops the Tests screen widening task creation as a side
    // effect.
    const keyFor = { case: "test_case.manage", run: "test_run.manage", bug: "bug.raise" };
    if (!keyFor[action]) {
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }
    const denied = requirePermission(auth, keyFor[action]);
    if (denied) return denied;

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    const svc = serviceClient();

    const projectId = body?.projectId;
    if (action !== "bug") {
      if (!UUID_RE.test(String(projectId || ""))) {
        return NextResponse.json({ success: false, error: "Choose a project" }, { status: 400 });
      }
      const { data: project } = await svc
        .from("projects")
        .select("id")
        .eq("organization_id", auth.orgId)
        .eq("id", projectId)
        .maybeSingle();
      if (!project) {
        return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
      }
    }

    if (action === "case") {
      const title = clip(body?.title, 300);
      if (!title) {
        return NextResponse.json({ success: false, error: "Give the case a title" }, { status: 400 });
      }
      const { data, error } = await svc
        .from("test_cases")
        .insert({
          organization_id: auth.orgId,
          project_id: projectId,
          title,
          preconditions: clip(body?.preconditions, 4000),
          steps: clip(body?.steps, 8000),
          expected_result: clip(body?.expectedResult, 4000),
          priority: ["high", "medium", "low"].includes(body?.priority) ? body.priority : "medium",
          status: body?.status === "draft" ? "draft" : "active",
          created_by: auth.appUserId,
        })
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, case: data });
    }

    if (action === "run") {
      const name = clip(body?.name, 200);
      if (!name) {
        return NextResponse.json({ success: false, error: "Give the run a name" }, { status: 400 });
      }

      const { data, error } = await svc.rpc('create_quality_run', {
        p_org: auth.orgId, p_actor: auth.appUserId, p_type: auth.userType,
        p_project: projectId, p_name: name, p_notes: clip(body?.notes, 4000),
      });
      if (error) return qualityTransactionError(error);
      return NextResponse.json(data);
    }

    const executionId = body?.executionId;
    if (!UUID_RE.test(String(executionId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid executionId" }, { status: 400 });
    }
    const { data, error } = await svc.rpc('raise_quality_bug', {
      p_org: auth.orgId, p_actor: auth.appUserId, p_type: auth.userType,
      p_execution: executionId, p_description: clip(body?.description, 8000),
      p_severity: SEVERITIES.includes(body?.severity) ? body.severity : "major",
      p_environment: clip(body?.environment, 2000),
    });
    if (error) return qualityTransactionError(error);
    return NextResponse.json(data);
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

    // Closing or reopening a run is a different act from recording a result,
    // and a narrower one.
    if (body?.runId) {
      if (!UUID_RE.test(String(body.runId))) {
        return NextResponse.json({ success: false, error: "Invalid runId" }, { status: 400 });
      }
      const denied = requirePermission(auth, "test_run.manage");
      if (denied) return denied;
      if (!["closed", "open"].includes(body?.status)) {
        return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
      }

      const billingBlocked = await requireUnlocked(svc, auth.orgId);
      if (billingBlocked) {
        return NextResponse.json(
          { success: false, ...billingBlocked },
          { status: billingBlocked.status }
        );
      }

      const now = new Date().toISOString();
      const { data, error } = await svc
        .from("test_runs")
        .update(
          body.status === "closed"
            ? { status: "closed", closed_at: now, closed_by: auth.appUserId, updated_at: now }
            : { status: "open", closed_at: null, closed_by: null, updated_at: now }
        )
        .eq("organization_id", auth.orgId)
        .eq("id", body.runId)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, run: data });
    }

    const executionId = body?.executionId;
    if (!UUID_RE.test(String(executionId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid executionId" }, { status: 400 });
    }
    const denied = requirePermission(auth, "test_run.execute");
    if (denied) return denied;

    if (!RESULTS.includes(body?.result)) {
      return NextResponse.json({ success: false, error: "Invalid result" }, { status: 400 });
    }

    const billingBlocked = await requireUnlocked(svc, auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const { data, error } = await svc
      .from("test_executions")
      .update({
        result: body.result,
        notes: clip(body?.notes, 4000),
        executed_by: auth.appUserId,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", auth.orgId)
      .eq("id", executionId)
      .select()
      .single();

    if (error) {
      // The trigger in 081 refuses a write to a closed run. Say what happened.
      const closed = /test run is closed/i.test(error.message || "");
      return NextResponse.json(
        { success: false, error: closed ? "That test run is closed. Reopen it first." : error.message },
        { status: closed ? 409 : 500 }
      );
    }
    return NextResponse.json({ success: true, execution: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not record that" },
      { status: 500 }
    );
  }
}
