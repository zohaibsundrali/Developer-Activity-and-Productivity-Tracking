import { supabase } from "@/utils/supabaseClient";
import {
  isOpenTask,
  isOverdue,
  loadLevel,
  loadOrgWorkGraph,
  personLoad,
} from "@/utils/orgWorkGraph";
import { isProjectOpen, normalizeProjectStatus, projectStatusMeta } from "@/utils/projectStatus";

/**
 * Everything the admin Overview shows, loaded once and derived in memory.
 *
 * WHY A MODULE AND NOT FETCHES IN THE SCREEN
 *
 * The Overview shows eleven panels. Eleven panels that each fetch their own
 * data is eleven waterfalls, eleven spinners, and eleven chances for one panel
 * to disagree with another about how many projects there are. Every number here
 * is derived from ONE snapshot, so the KPI row and the table underneath it can
 * never contradict each other.
 *
 * IT IS EIGHT QUERIES, PLUS UP TO TWO THAT DEPEND ON WHO IS LOOKING. Counted,
 * not estimated:
 *
 *   5  loadOrgWorkGraph  — projects, developer_tasks, memberships, developers,
 *                          admin_users. Reused whole; Team Structure and
 *                          Capacity read the same graph, and the joining rules
 *                          for "who is on a project" are worth having once.
 *   1  project_proposals — the request queue.
 *   1  pm_activity       — the recent-actions feed.
 *   1  notifications     — this person's unread.
 *  +1  clients           — a head count, and ONLY when the viewer's role can
 *                          open that screen. See `withClients`.
 *  +1  task_submissions  — the size of the review queue, and ONLY when the
 *                          viewer's role can open Task Reviews. See
 *                          `withReviews`.
 *
 * Bugs cost ZERO extra queries: a bug is a developer_tasks row with
 * task_type='bug' (utils/bugs.js), and the graph now selects that column.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No money. Revenue, invoices, MRR and plan spend are the Billing screen's, and
 * that screen is owner/admin/finance while this one is also seen by HR. An
 * operations dashboard that quietly carries financials is how a number reaches
 * somebody who was never meant to see it. Company-wide OPERATIONAL visibility
 * is the whole brief.
 *
 * The one number that touches the commercial side — the client head count — is
 * gated by the same rule as everything else: it is fetched only when the
 * viewer's role can open the Clients screen, so HR never sees it and never
 * costs a request for it.
 *
 * EVERY COLUMN BELOW WAS VERIFIED AGAINST THE LIVE DATABASE before this
 * shipped. PostgREST rejects an entire request over one unknown column, so a
 * single typo does not degrade a panel — it blanks it, with nothing in the
 * console. `project_proposals.budget_range` was in the first draft of this file
 * and does not exist; the column is `budget`.
 */

/**
 * yyyy-mm-dd, for date-only comparison without a timezone argument.
 *
 * THE FALSY GUARD IS NOT DEFENSIVE PADDING. A default parameter only fills in
 * for `undefined`, so an explicit `null` — which is what a project with no
 * deadline column actually carries — sailed past it into `new Date(null)`,
 * which is the epoch and is a perfectly VALID date. `daysUntil` then answered
 * -20678 and the row rendered "20678d late" in red. A null that becomes 1970 is
 * worse than a null that throws, because it looks like data.
 */
export function ymd(value = new Date()) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Whole days from today to a date. Negative is in the past. */
export function daysUntil(value, today = ymd()) {
  const then = ymd(value);
  if (!then || !today) return null;
  return Math.round((Date.parse(then) - Date.parse(today)) / 86_400_000);
}

/**
 * The proposal queue, in the four states the product actually has.
 *
 * The brief asked for "pending, approved, rejected, needing review". The schema
 * (database/059) has five: submitted, in_review, needs_info, accepted,
 * rejected. The difference is not pedantry — `needs_info` is waiting on the
 * CLIENT, and counting it as "pending" tells an admin to act on something that
 * is not theirs to act on. So the buckets are grouped by WHOSE MOVE IT IS.
 */
export const PROPOSAL_BUCKETS = [
  {
    id: "awaiting_you",
    label: "Needs your decision",
    statuses: ["submitted", "in_review"],
    tone: "warning",
    hint: "Sitting with you.",
  },
  {
    id: "awaiting_client",
    label: "Waiting on the client",
    statuses: ["needs_info"],
    tone: "info",
    hint: "You asked a question; they have not answered.",
  },
  { id: "accepted", label: "Accepted", statuses: ["accepted"], tone: "success", hint: "A project exists for it." },
  { id: "rejected", label: "Rejected", statuses: ["rejected"], tone: "muted", hint: "Declined, with a reason." },
];

/**
 * The four task buckets.
 *
 * THERE IS NO `blocked` STATUS. The lifecycle is
 * pending → in_progress → awaiting_approval → [reviewed] → completed/rejected
 * (database/021), and inventing a fifth bucket that no row can ever be in
 * produces a tile that reads 0 forever and teaches people to ignore the row.
 *
 * `rejected` is the closest true thing: work sent back that its author has to
 * pick up again. It is labelled for what it is rather than borrowed as
 * "blocked", so nobody reads it as "waiting on a dependency".
 */
export const TASK_BUCKETS = [
  { id: "in_progress", label: "In progress", tone: "info" },
  { id: "overdue", label: "Overdue", tone: "error" },
  { id: "sent_back", label: "Sent back", tone: "warning" },
  { id: "due_soon", label: "Due in 7 days", tone: "primary" },
];

/** How close a deadline has to be to count as "soon". */
export const SOON_DAYS = 7;

/**
 * Why a project is at risk — reasons, not a boolean.
 *
 * A count of at-risk projects that cannot say WHY is a number nobody can act
 * on. Each reason is a sentence the reader can check against the row.
 *
 * Only OPEN projects can be at risk: a completed project with a passed deadline
 * finished late, which is a fact for Reports, not a thing to chase today.
 */
export function projectRisk(project, tasks = [], today = ymd()) {
  const reasons = [];
  const status = normalizeProjectStatus(project?.status);
  if (!isProjectOpen(status)) return reasons;

  const due = project?.deadline || project?.end_date || null;
  const left = due ? daysUntil(due, today) : null;
  const progress = Number(project?.progress) || 0;

  if (left != null && left < 0) {
    reasons.push(`Deadline passed ${Math.abs(left)} ${Math.abs(left) === 1 ? "day" : "days"} ago`);
  } else if (left != null && left <= SOON_DAYS && progress < 70) {
    reasons.push(`Due in ${left} ${left === 1 ? "day" : "days"} at ${progress}%`);
  }

  const late = tasks.filter((t) => isOverdue(t, today)).length;
  if (late > 0) reasons.push(`${late} overdue ${late === 1 ? "task" : "tasks"}`);

  if (status === "on_hold") reasons.push("On hold");

  return reasons;
}

/**
 * One row per project for the All Projects table: the six facts the brief asks
 * for, plus the risk reasons, resolved against the graph so the table itself
 * does no lookups.
 */
export function projectRows(graph, today = ymd()) {
  const rows = (graph?.projects || []).map((p) => {
    const tasks = graph.tasksByProject?.get(String(p.id)) || [];
    const manager = p.manager_id ? graph.personById?.get(String(p.manager_id)) : null;
    const open = tasks.filter(isOpenTask).length;
    return {
      id: p.id,
      name: p.name || "Untitled project",
      manager: manager || null,
      status: normalizeProjectStatus(p.status),
      statusMeta: projectStatusMeta(p.status),
      priority: p.priority || null,
      progress: Math.max(0, Math.min(100, Number(p.progress) || 0)),
      deadline: p.deadline || p.end_date || null,
      daysLeft: daysUntil(p.deadline || p.end_date, today),
      openTasks: open,
      overdueTasks: tasks.filter((t) => isOverdue(t, today)).length,
      risks: projectRisk(p, tasks, today),
    };
  });

  // Riskiest first, then soonest deadline. A dashboard sorted by creation date
  // buries the row that needed reading.
  return rows.sort((a, b) => {
    if (a.risks.length !== b.risks.length) return b.risks.length - a.risks.length;
    if (a.daysLeft == null) return 1;
    if (b.daysLeft == null) return -1;
    return a.daysLeft - b.daysLeft;
  });
}

/** Tasks split into the four buckets above. One pass, not four filters. */
export function taskBuckets(graph, today = ymd()) {
  const out = { in_progress: [], overdue: [], sent_back: [], due_soon: [] };
  for (const t of graph?.tasks || []) {
    if (t.status === "rejected") out.sent_back.push(t);
    if (!isOpenTask(t)) continue;
    if (t.status === "in_progress") out.in_progress.push(t);
    if (isOverdue(t, today)) out.overdue.push(t);

    // `left >= 0` is the ONE thing keeping an already-late task out of "due
    // soon"; without it the four tiles add up to more work than exists.
    //
    // There used to be a `continue` in the branch above doing the same job.
    // Mutation testing could kill neither guard — each covered the other — and
    // a guard that no test can kill is a guard nobody can tell is load-bearing.
    // One of them had to go, and the clamp is the one that also copes with a
    // task whose due_date is unreadable.
    const left = daysUntil(t.due_date, today);
    if (left != null && left >= 0 && left <= SOON_DAYS) out.due_soon.push(t);
  }
  return out;
}

/** Open bugs and the ones sitting in QA, off the same task rows. */
export function bugSummary(graph) {
  const bugs = (graph?.tasks || []).filter((t) => t.task_type === "bug");
  return {
    total: bugs.length,
    open: bugs.filter(isOpenTask).length,
    // `awaiting_approval` is "the developer says it is fixed"; `reviewed` is
    // "QA has picked it up". Both are waiting on a tester, which is the queue
    // an admin wants the size of.
    inQa: bugs.filter((b) => b.status === "awaiting_approval" || b.status === "reviewed").length,
    bugs,
  };
}

/**
 * One row per person: role, what they are carrying, and how many projects it
 * spans.
 *
 * Team Overview and Team Workload are ONE table, not two. They are the same
 * four people with the same names in the same order; drawing them twice fills
 * the screen without adding a fact, and the reader has to check whether the two
 * lists agree. Availability (the load level) and the assignment counts sit as
 * columns on the single table instead.
 */
export function peopleRows(graph, today = ymd()) {
  return (graph?.people || [])
    .map((person) => {
      // personLoad already counts distinct projects INCLUDING the ones this
      // person manages but holds no task on — a manager of three projects with
      // no tasks of their own is not idle, and re-deriving that here would be a
      // second definition of "assigned" for the same table to disagree with.
      const load = personLoad(person, graph, today);
      return {
        ...person,
        openTasks: load.openTasks,
        overdue: load.overdue,
        level: loadLevel({ openTasks: load.openTasks, overdue: load.overdue }),
        projectCount: load.projectCount,
        managingCount: load.managingCount,
      };
    })
    // Busiest first — but overdue outranks volume, the same rule loadLevel
    // applies, so the person in trouble is not below somebody merely busy.
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.openTasks - a.openTasks ||
        String(a.name).localeCompare(String(b.name))
    );
}

/** Every headline number the Overview can show. */
export function overviewKpis({
  graph,
  proposals,
  clientCount,
  pendingReviews,
  today = ymd(),
}) {
  const projects = graph?.projects || [];
  const rows = projectRows(graph, today);
  const people = peopleRows(graph, today);
  const bugs = bugSummary(graph);
  const awaiting = new Set(PROPOSAL_BUCKETS[0].statuses);

  return {
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => isProjectOpen(normalizeProjectStatus(p.status))).length,
    pendingProposals: (proposals || []).filter((p) => awaiting.has(p.status)).length,
    teamMembers: (graph?.people || []).filter((p) => p.status === "active").length,
    overdueTasks: (graph?.tasks || []).filter((t) => isOverdue(t, today)).length,
    atRiskProjects: rows.filter((r) => r.risks.length > 0).length,

    // The three below exist for the roles that cannot open a project screen.
    // An HR user seeing "Total projects" is being shown a number they have no
    // door to; these are theirs, and every one of them is actionable from a
    // screen HR can actually open.
    unmanagedProjects: projects.filter(
      (p) => !p.manager_id && isProjectOpen(normalizeProjectStatus(p.status))
    ).length,
    overloadedPeople: people.filter((p) => p.level?.id === "overloaded").length,
    availablePeople: people.filter((p) => p.level?.id === "free" || p.level?.id === "light").length,
    rolesInUse: new Set((graph?.people || []).map((p) => p.role).filter(Boolean)).size,

    // QA'S THREE. QA can open exactly two screens — Task Reviews and Bugs — so
    // without these a QA user landed on an Overview with an EMPTY KPI row, the
    // same failure finance had before `clientCount`. Both bug counts are free:
    // a bug is a developer_tasks row with task_type='bug' and the graph already
    // carries that column.
    openBugs: bugs.open,
    bugsInQa: bugs.inQa,

    // Only ever non-null for a viewer who can open Task Reviews; see the
    // conditional query in loadAdminOverview.
    pendingReviews: pendingReviews ?? 0,

    // Only ever non-null for a viewer who can open Clients; see the note on
    // the conditional query in loadAdminOverview.
    clientCount: clientCount ?? 0,
  };
}

/**
 * The KPI catalogue, in priority order, each one naming the screen it opens.
 *
 * ONE RULE PRODUCES THREE DASHBOARDS: show a tile only when the viewer could
 * open the screen behind it, then take the first six. Nothing is hand-assigned
 * per role, so a change to ADMIN_SECTION_ROLES moves the tiles with it and the
 * two cannot drift.
 *
 *   owner / admin   1–6: the delivery view — projects, risk, proposals, people.
 *   manager / lead  1–5 then unmanaged projects: no Employees for them, so the
 *                   sixth slot falls through to the org chart, which they can
 *                   open and which is about the work.
 *   HR              none of the first five. They get people, unmanaged
 *                   projects, overloaded, available and roles in use — a
 *                   dashboard about staffing, which is the job.
 *   QA              none of the first ten. Reviews waiting, open bugs, bugs
 *                   in QA — the queue they are answerable for.
 *   finance         one: the client head count. Their other screen is
 *                   Billing, and no money number belongs on this dashboard.
 *
 * The order is delivery-first because that is the larger audience; the
 * people-side tiles sit below it and surface for whoever has nothing above.
 */
export const KPI_CATALOGUE = [
  { key: "totalProjects", section: "all-projects" },
  { key: "activeProjects", section: "all-projects" },
  { key: "atRiskProjects", section: "project-hub" },
  { key: "overdueTasks", section: "views" },
  { key: "pendingProposals", section: "requests" },
  { key: "teamMembers", section: "employees" },
  { key: "unmanagedProjects", section: "hierarchy" },
  { key: "overloadedPeople", section: "capacity" },
  { key: "availablePeople", section: "capacity" },
  { key: "rolesInUse", section: "team-stats" },
  // Finance can open exactly two screens — Clients and Billing — so without
  // this entry a finance user lands on an Overview with an EMPTY KPI row. A
  // role admitted to the area and shown nothing reads as a broken screen
  // rather than a restricted one. Caught by its own test, not by review.
  { key: "clientCount", section: "clients" },

  // QA, for the same reason. Their two screens are Task Reviews and Bugs, and
  // the queue they are answerable for comes first. These sit at the tail
  // because owner, admin, manager and team lead have filled all six slots long
  // before here — appending cannot disturb a dashboard that is already full,
  // and for QA the tail IS the dashboard.
  { key: "pendingReviews", section: "task-reviews" },
  { key: "openBugs", section: "bugs" },
  { key: "bugsInQa", section: "bugs" },
];

/** How many tiles the KPI row shows. Two full rows of three at `lg`. */
export const KPI_SLOTS = 6;

/**
 * The snapshot.
 *
 * Only the work graph is fatal. A dashboard with no activity feed is thinner
 * than intended; a dashboard that refuses to render because one side panel
 * failed is broken. Each secondary read resolves to an empty list of its own
 * accord — `Promise.all` over `.then(...)` rather than `await` in sequence, so
 * one slow table cannot hold the other two.
 */
export async function loadAdminOverview(
  orgId,
  { adminId, adminEmail, developerId, withClients = false, withReviews = false } = {}
) {
  if (!orgId) throw new Error("Your session has no organization. Sign in again.");

  const proposalsQ = supabase
    .from("project_proposals")
    .select("id, title, status, created_at, client_id, desired_deadline, budget, currency")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  const activityQ = supabase
    .from("pm_activity")
    .select("id, project_id, entity_type, action, actor_id, meta, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(12);

  // Scoped to the signed-in person, exactly as the topbar bell is. An Overview
  // that showed everybody's notifications would be a second inbox nobody owns.
  //
  // THE RECIPIENT COLUMN DEPENDS ON WHICH TABLE THEY ARE IN. `notifications`
  // has `admin_id`, `admin_email` and `developer_id` — verified live — and the
  // admin shell is now reached by roles whose profile row is in `developers`
  // (project manager, team lead, HR, QA, finance). Filtering on admin_id alone
  // does not error for them; it quietly returns nothing, and an empty panel
  // reads as "you have no notifications" rather than "we looked in the wrong
  // column".
  let notificationsQ = supabase
    .from("notifications")
    .select("id, title, message, category, type, created_at, project_id, read")
    .eq("organization_id", orgId)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(8);
  const or = [];
  if (adminId) or.push(`admin_id.eq.${adminId}`);
  if (adminEmail) or.push(`admin_email.ilike.%${adminEmail}%`);
  if (developerId) or.push(`developer_id.eq.${developerId}`);
  notificationsQ = or.length ? notificationsQ.or(or.join(",")) : notificationsQ.limit(0);

  // A NINTH QUERY, AND ONLY FOR THE PEOPLE WHO CAN SEE THE ANSWER. Clients are
  // owner/admin/finance; firing this for an HR user would spend a request on a
  // number their screen will not render. `head: true` returns the count and no
  // rows.
  const clientsQ = withClients
    ? supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .then((r) => r.count ?? 0)
        .catch(() => 0)
    : Promise.resolve(null);

  // A TENTH, ON THE SAME TERMS. Task Reviews is the one QA screen whose
  // number is not already in the work graph: a submission is a
  // `task_submissions` row, not a `developer_tasks` row, and `review_status`
  // is its own field. Columns verified live before this shipped.
  //
  // Fired only for a viewer who can open the screen — owner, admin, manager,
  // team lead and QA — so HR, finance and a client never spend a request on a
  // queue they cannot see. `head: true` returns the count and no rows.
  const reviewsQ = withReviews
    ? supabase
        .from("task_submissions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("review_status", "pending")
        .then((r) => r.count ?? 0)
        .catch(() => 0)
    : Promise.resolve(null);

  const [graph, proposals, activity, notifications, clientCount, pendingReviews] =
    await Promise.all([
      loadOrgWorkGraph(orgId),
      proposalsQ.then((r) => r.data || []).catch(() => []),
      activityQ.then((r) => r.data || []).catch(() => []),
      notificationsQ.then((r) => r.data || []).catch(() => []),
      clientsQ,
      reviewsQ,
    ]);

  return { graph, proposals, activity, notifications, clientCount, pendingReviews };
}
