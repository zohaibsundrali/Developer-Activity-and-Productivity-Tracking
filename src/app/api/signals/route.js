import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { resolveEntitlement, getUsage } from "@/utils/entitlements";
import { runDetectors, filterForViewer, DEFAULTS } from "@/utils/signals";
import { authCan } from "@/utils/serverPermissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/signals — what needs attention in this workspace right now.
 *
 * Computed on every request rather than stored. There is no `signals` table and
 * no migration: a signal is a statement about the CURRENT state of other rows,
 * so persisting it would immediately create a second source of truth that goes
 * stale the moment a review is done. The daily run in /api/cron writes the ones
 * worth interrupting somebody about into `notifications`, which is a record of
 * "we told you", not a record of "this is true".
 *
 * WHO SEES WHAT
 *  These are statements about named people's working patterns, so visibility
 *  follows the same shape as the rest of the monitoring surface rather than
 *  being open to everyone with a login:
 *
 *    owner, admin  everything, including plan pressure (they pay the bill)
 *    hr            everything about people; not billing
 *    manager       only their own direct reports, plus the team-level signals
 *    everyone else nothing — 403
 *
 *  The manager rule reads `memberships.reports_to`, which is the same hierarchy
 *  the rest of the product uses. Note that it is currently unset for everyone,
 *  so a manager sees no person-level signals at all today — that is the honest
 *  behaviour of an empty hierarchy, not a bug to route around by widening it.
 *
 * The organization always comes from the verified JWT, never from the request.
 */

// The role lists live in src/utils/signals.js beside the filter that applies
// them, so this route and the nightly job cannot drift apart on who sees what.

/** How far back to read sessions: the drop detector's full comparison window. */
const LOOKBACK_DAYS = (DEFAULTS.baselineWeeks + 1) * DEFAULTS.windowDays;

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // ASK THE KEY, NOT THE LIST. `SIGNAL_ROLES` is owner/admin/hr + manager +
    // team_lead, which is exactly what `signal.view` grants — the two were the
    // same set written down twice, which is how they stop being the same set.
    // `authCan` also honours a per-person override; a role array cannot.
    if (!authCan(auth, "signal.view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = serviceClient();
    const now = new Date();
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString();

    const bundle = await collect(svc, auth, now, since);
    // One shared, pure implementation of the visibility rule — the nightly job
    // in /api/cron applies the same function to the same signals.
    const signals = filterForViewer(runDetectors(bundle, now), {
      role: auth.role,
      visiblePeople: bundle.visiblePeople,
    });

    return NextResponse.json({
      generatedAt: now.toISOString(),
      counts: {
        critical: signals.filter((s) => s.severity === "critical").length,
        warning: signals.filter((s) => s.severity === "warning").length,
        info: signals.filter((s) => s.severity === "info").length,
      },
      signals,
    });
  } catch (e) {
    console.error("[signals]", e?.message || e);
    // An empty list, not a 500. This drives a dashboard panel; a panel that
    // errors is worse than a panel that says "nothing to flag", and the caller
    // can tell the two apart from `degraded`.
    return NextResponse.json({ generatedAt: null, counts: {}, signals: [], degraded: true });
  }
}

/**
 * One organization's data, fetched once.
 *
 * Exported so the cron job runs the identical query set — two copies of "what
 * the detectors need" would drift, and the first symptom would be the daily
 * email disagreeing with the dashboard.
 */
export async function collect(svc, auth, now, since) {
  const orgId = auth.orgId;

  const [sessionsRes, submissionsRes, tasksRes, sprintsRes, projectsRes, membersRes] =
    await Promise.all([
      svc
        .from("productivity_sessions")
        .select("user_id, user_email, start_time, active_duration")
        .eq("organization_id", orgId)
        .gte("start_time", since)
        // ORDERED, and this matters. Without it PostgREST returns an arbitrary
        // 20,000 rows in physical order — and a 60-person team over the 35-day
        // lookback is already past that. Truncation would then drop the NEWEST
        // rows, which is exactly the current window, manufacturing a mass
        // "activity down 100%" across the whole company. Newest first means a
        // cap costs the oldest baseline data, which only makes the detector
        // more conservative.
        .order("start_time", { ascending: false })
        .limit(20000),
      svc
        .from("task_submissions")
        .select("id, task_id, developer_id, submitted_at, is_reviewed")
        .eq("organization_id", orgId)
        .eq("is_reviewed", false)
        .limit(5000),
      svc
        .from("developer_tasks")
        .select("id, project_id, developer_id, sprint_id, status, due_date, end_date, updated_at, created_at")
        .eq("organization_id", orgId)
        .limit(20000),
      svc
        .from("sprints")
        .select("id, name, status, end_date")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .limit(200),
      // `name`, not `project_name` — the latter does not exist on this table,
      // and asking for it makes PostgREST reject the whole select, which would
      // have shown up only as an empty panel with `degraded: true`.
      svc.from("projects").select("id, name").eq("organization_id", orgId).limit(2000),
      svc
        .from("memberships")
        .select("user_id, email, role, reports_to, status")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .limit(5000),
    ]);

  // Names for the messages. `developers` is the profile table sessions point at.
  const { data: devs } = await svc
    .from("developers")
    .select("id, name, email")
    .eq("organization_id", orgId)
    .limit(5000);

  const people = {};
  for (const d of devs || []) {
    if (d.id) people[d.id] = d.name || d.email || "A team member";
    if (d.email) people[d.email] = d.name || d.email;
  }
  for (const m of membersRes.data || []) {
    if (m.user_id && !people[m.user_id]) people[m.user_id] = m.email || "A team member";
  }

  const projects = {};
  for (const p of projectsRes.data || []) {
    projects[p.id] = p.name || "a project";
  }

  // Who this caller may be told about, when they are a manager — and the whole
  // hierarchy, which the nightly job needs to address a person-level signal to
  // that person's OWN manager rather than to every manager in the company.
  //
  // KEYED BY BOTH IDENTIFIERS, and this is the whole point. `memberships.user_id`
  // is a `developers.id`; a signal's subject id comes from
  // `productivity_sessions`, where the reliable identifier is the EMAIL (see
  // personKey in src/utils/signals.js, and migration 050's note that every
  // user_id on 458 orphan rows was in fact an address). Keying only by user_id
  // meant `visible.has(subject.id)` compared an email against a set of UUIDs
  // and was always false — so a manager saw NO person-level signals even with a
  // fully populated reporting tree, and the cron never delivered one to a
  // manager at all. Registering both spellings is what makes the rule work
  // whichever identifier the session rows happen to carry.
  const visiblePeople = new Set();
  const reportsTo = {};
  const me = new Set(
    [auth.appUserId, auth.userId, auth.email]
      .filter(Boolean)
      .map((v) => String(v).trim().toLowerCase())
  );

  for (const m of membersRes.data || []) {
    const aliases = [m.user_id, m.email]
      .filter(Boolean)
      .map((v) => String(v).trim().toLowerCase());

    if (m.reports_to) {
      for (const alias of aliases) reportsTo[alias] = String(m.reports_to).trim().toLowerCase();
    }
    if (m.reports_to && me.has(String(m.reports_to).trim().toLowerCase())) {
      for (const alias of aliases) visiblePeople.add(alias);
    }
  }

  // Plan usage, from the existing entitlement engine rather than a second count.
  let usage = {};
  try {
    const entitlement = await resolveEntitlement(svc, orgId, now);
    usage = await getUsage(svc, orgId, entitlement.limits);
  } catch {
    // Billing pressure simply does not appear — never a reason to fail the rest.
  }

  return {
    sessions: sessionsRes.data || [],
    submissions: submissionsRes.data || [],
    tasks: tasksRes.data || [],
    sprints: sprintsRes.data || [],
    usage,
    people,
    projects,
    visiblePeople,
    reportsTo,
  };
}
