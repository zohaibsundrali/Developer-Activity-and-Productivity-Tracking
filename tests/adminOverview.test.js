import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PROPOSAL_BUCKETS,
  TASK_BUCKETS,
  SOON_DAYS,
  bugSummary,
  daysUntil,
  overviewKpis,
  peopleRows,
  projectRisk,
  projectRows,
  taskBuckets,
  ymd,
} from "@/utils/adminOverview";

/**
 * The admin Overview.
 *
 * WHAT IT REPLACED, AND THE BUG THAT MATTERS MOST
 *
 * Three stat cards, all three scoped to `created_by = me` — "My Developers",
 * "My Projects", "Pending Notifications". For the founder, who created
 * everything, that read as the whole organization BY ACCIDENT. For a second
 * admin who joined later it read 0, 0, 0: an empty product with a full database
 * behind it, and nothing on screen to suggest the numbers were personal rather
 * than organizational.
 *
 * That is the regression this file exists to prevent: the moment a query here
 * grows an `added_by` or `created_by` filter, the dashboard silently starts
 * lying to everyone except the person who built the org.
 *
 * THE OTHER THING IT HOLDS: honesty about what the schema actually has. The
 * brief asked for a "Blocked" bucket and for proposals grouped "pending /
 * approved / rejected". Neither exists as asked — there is no blocked task
 * status, and proposals have five states, one of which is waiting on the
 * CLIENT. Tiles that can never be non-zero, and buckets that tell an admin to
 * act on something that is not theirs, are worse than absent ones.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TODAY = "2026-08-13";
const day = (offset) =>
  new Date(Date.parse(TODAY) + offset * 86_400_000).toISOString().slice(0, 10);

/** A graph shaped exactly like loadOrgWorkGraph's return. */
function graphOf({ projects = [], tasks = [], people = [] } = {}) {
  const tasksByProject = new Map();
  const tasksByPerson = new Map();
  for (const t of tasks) {
    if (t.project_id) {
      const k = String(t.project_id);
      if (!tasksByProject.has(k)) tasksByProject.set(k, []);
      tasksByProject.get(k).push(t);
    }
    if (t.developer_id) {
      const k = String(t.developer_id);
      if (!tasksByPerson.has(k)) tasksByPerson.set(k, []);
      tasksByPerson.get(k).push(t);
    }
  }
  return {
    projects,
    projectById: new Map(projects.map((p) => [String(p.id), p])),
    tasks,
    tasksByProject,
    tasksByPerson,
    people,
    personById: new Map(people.map((p) => [String(p.userId), p])),
    personByEmail: new Map(),
  };
}

describe("nothing here is scoped to the signed-in person", () => {
  const LOADER = stripComments(read("src/utils/adminOverview.js"));
  const SCREEN = stripComments(read("src/components/admin/DashboardOverview.jsx"));

  it("filters by organization, never by who created the row", () => {
    // The exact filters the old dashboard used. Their return is the whole bug.
    for (const forbidden of ["added_by", "created_by", "added_by_admin"]) {
      expect(LOADER, `loader must not filter on ${forbidden}`).not.toContain(forbidden);
    }
    expect(LOADER).toContain('.eq("organization_id", orgId)');
  });

  it("keeps notifications personal, because the bell is", () => {
    // The ONE thing that is legitimately per-person. An Overview showing
    // everybody's notifications would be a second inbox nobody owns.
    expect(LOADER).toMatch(/admin_id\.eq\.\$\{adminId\}/);
    expect(LOADER).toMatch(/\.eq\("read", false\)/);
  });

  it("does not put money on an operations screen", () => {
    // Billing is owner/admin/finance. This screen is also seen by HR, so a
    // revenue figure here is a number reaching somebody never meant to see it.
    for (const word of ["revenue", "invoice", "mrr", "stripe", "amount_due"]) {
      expect(SCREEN.toLowerCase(), `no ${word} on the Overview`).not.toContain(word);
    }
  });

  it("drops the profile block that used to sit under the counters", () => {
    // It says who you are, not how the work is going, and Account owns it.
    expect(SCREEN).not.toContain("Profile information");
    expect(SCREEN).not.toContain("ProfileField");
  });
});

describe("bugs cost no extra query, which depends on one column", () => {
  it("the shared work graph still selects task_type", () => {
    // A bug IS a developer_tasks row with task_type='bug' (utils/bugs.js).
    // Drop the column from the select and bugSummary silently returns 0 for
    // everything — no error, no console line, just a QA panel that says the
    // product has no bugs. This is the assertion that fails instead.
    const graph = stripComments(read("src/utils/orgWorkGraph.js"));
    expect(graph).toMatch(/\.select\(\s*"[^"]*task_type[^"]*"/);
  });

  it("counts open bugs and the ones waiting on a tester", () => {
    const g = graphOf({
      tasks: [
        { id: 1, task_type: "bug", status: "pending" },
        { id: 2, task_type: "bug", status: "awaiting_approval" },
        { id: 3, task_type: "bug", status: "reviewed" },
        { id: 4, task_type: "bug", status: "completed" },
        { id: 5, task_type: "feature", status: "pending" },
      ],
    });
    const s = bugSummary(g);
    expect(s.total).toBe(4); // the feature is not a bug
    expect(s.open).toBe(2); // completed and reviewed are off the plate
    expect(s.inQa).toBe(2); // awaiting_approval + reviewed
  });
});

describe("the conditional queries only fire for people who can see the answer", () => {
  const LOADER = stripComments(read("src/utils/adminOverview.js"));
  const SCREEN = stripComments(read("src/components/admin/DashboardOverview.jsx"));

  it("gates each one on its flag, and resolves rather than rejects when off", () => {
    expect(LOADER).toMatch(/const clientsQ = withClients\s*\?/);
    expect(LOADER).toMatch(/const reviewsQ = withReviews\s*\?/);
    // Promise.all takes both branches. A `false` branch that threw would take
    // the whole dashboard down for the roles that skip the query.
    expect(LOADER.match(/: Promise\.resolve\(null\)/g) || []).toHaveLength(2);
  });

  it("decides the flags by the same section rule that decides the tiles", () => {
    // If these ever disagree with canAccessAdminSection, a viewer either pays
    // for a query whose number their screen will not render, or gets a tile
    // that is permanently zero because nothing fetched it.
    expect(SCREEN).toMatch(/withClients: canAccessAdminSection\("clients"/);
    expect(SCREEN).toMatch(/withReviews: canAccessAdminSection\("task-reviews"/);
  });

  it("asks the review queue for a count, not for the rows", () => {
    // Columns verified live: task_submissions has id, review_status,
    // organization_id, task_id. PostgREST rejects the whole request over one
    // unknown column, so a typo here blanks the tile with nothing in the
    // console.
    expect(LOADER).toMatch(/from\("task_submissions"\)[\s\S]{0,160}head: true/);
    expect(LOADER).toMatch(/\.eq\("review_status", "pending"\)/);
  });
});

describe("the vocabularies match what the database can actually hold", () => {
  it("proposal buckets cover every status the CHECK constraint allows", () => {
    // Read from the migration, not retyped. A status the schema permits but no
    // bucket claims is a proposal that exists and appears in no count — the
    // most invisible kind of missing row.
    const sql = read("database/059_project_proposals.sql");
    const match = sql.match(/check \(status in \(([^)]+)\)\)/);
    expect(match, "the CHECK constraint should be findable").toBeTruthy();
    const allowed = match[1].split(",").map((s) => s.trim().replace(/'/g, ""));

    const claimed = PROPOSAL_BUCKETS.flatMap((b) => b.statuses);
    expect([...claimed].sort()).toEqual([...allowed].sort());
    // …and no status is claimed twice, which would double-count it.
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("separates what is waiting on you from what is waiting on the client", () => {
    // `needs_info` means YOU asked a question. Counting it as pending tells an
    // admin to act on something that is not theirs to act on.
    const mine = PROPOSAL_BUCKETS.find((b) => b.id === "awaiting_you");
    expect(mine.statuses).toEqual(["submitted", "in_review"]);
    const theirs = PROPOSAL_BUCKETS.find((b) => b.id === "awaiting_client");
    expect(theirs.statuses).toEqual(["needs_info"]);
  });

  it("invents no `blocked` task status", () => {
    // The lifecycle is pending -> in_progress -> awaiting_approval ->
    // [reviewed] -> completed/rejected (database/021). A tile for a state no
    // row can be in reads 0 forever and teaches people to ignore the row.
    const ids = TASK_BUCKETS.map((b) => b.id);
    expect(ids).not.toContain("blocked");
    expect(ids).toContain("sent_back");
    // And the screen says so, rather than leaving it as a source comment.
    const screen = read("src/components/admin/DashboardOverview.jsx");
    expect(screen).toMatch(/no separate .blocked. state/i);
  });
});

describe("at-risk is a set of reasons, not a red dot", () => {
  it("says the deadline has passed, and by how much", () => {
    const reasons = projectRisk(
      { status: "active", deadline: day(-3), progress: 40 },
      [],
      TODAY
    );
    expect(reasons).toContain("Deadline passed 3 days ago");
  });

  it("flags a near deadline only when the progress does not support it", () => {
    const behind = projectRisk({ status: "active", deadline: day(2), progress: 20 }, [], TODAY);
    expect(behind).toContain("Due in 2 days at 20%");
    // Nearly finished and due in two days is not a risk, it is a project.
    const fine = projectRisk({ status: "active", deadline: day(2), progress: 95 }, [], TODAY);
    expect(fine).toEqual([]);
  });

  it("counts overdue tasks as their own reason", () => {
    const reasons = projectRisk({ status: "active", progress: 50 }, [
      { status: "pending", due_date: day(-1) },
      { status: "pending", due_date: day(-5) },
      { status: "completed", due_date: day(-9) }, // finished late is not open
    ], TODAY);
    expect(reasons).toEqual(["2 overdue tasks"]);
  });

  it("never flags a project that is already finished", () => {
    // A completed project with a passed deadline finished LATE, which is a fact
    // for Reports — not something to chase today.
    for (const status of ["completed", "closed", "cancelled"]) {
      expect(projectRisk({ status, deadline: day(-30), progress: 100 }, [], TODAY)).toEqual([]);
    }
  });

  it("treats on hold as a risk of its own", () => {
    expect(projectRisk({ status: "on_hold", progress: 50 }, [], TODAY)).toContain("On hold");
  });
});

describe("the projects table puts the row that needs reading first", () => {
  const g = graphOf({
    projects: [
      { id: "calm", name: "Calm", status: "active", progress: 90, deadline: day(60) },
      { id: "late", name: "Late", status: "active", progress: 10, deadline: day(-2) },
      { id: "soon", name: "Soon", status: "active", progress: 10, deadline: day(3) },
    ],
    people: [{ userId: "m1", name: "Mina", role: "manager", status: "active" }],
  });

  it("sorts by risk FIRST, even when the risky project is due much later", () => {
    /*
     * The data matters here. An earlier version of this test used projects
     * whose risk order and deadline order happened to agree, so deleting the
     * risk comparison entirely left it passing — a vacuous assertion that
     * proved only that `sort` runs.
     *
     * `Held` is on hold and due in three months; `Close` is healthy and due
     * tomorrow. Sorting by deadline puts Close first. Sorting by risk — which
     * is the rule — puts Held first, because "on hold" is the thing somebody
     * has to decide about and a healthy project due tomorrow is just a project.
     */
    const disagreeing = graphOf({
      projects: [
        { id: "close", name: "Close", status: "active", progress: 95, deadline: day(1) },
        { id: "held", name: "Held", status: "on_hold", progress: 40, deadline: day(90) },
      ],
    });
    expect(projectRows(disagreeing, TODAY).map((r) => r.name)).toEqual(["Held", "Close"]);
  });

  it("falls back to the soonest deadline when the risk is equal", () => {
    const rows = projectRows(g, TODAY);
    expect(rows.map((r) => r.name)).toEqual(["Late", "Soon", "Calm"]);
    // Late and Soon each carry exactly ONE reason — a passed deadline, and a
    // near one at 10% — so the risk comparison ties and the deadline decides
    // between them. Calm carries none and sorts last regardless of its date.
    expect(rows[0].risks).toHaveLength(1);
    expect(rows[1].risks).toHaveLength(1);
    expect(rows[2].risks).toEqual([]);
  });

  it("resolves the manager so the table does no lookups of its own", () => {
    const withPm = graphOf({
      projects: [{ id: "p", name: "P", status: "active", manager_id: "m1" }],
      people: [{ userId: "m1", name: "Mina", role: "manager", status: "active" }],
    });
    expect(projectRows(withPm, TODAY)[0].manager.name).toBe("Mina");
    // A project with no manager yields null, not a fabricated name — Team
    // Structure's "Without a manager" section is the thing that acts on it.
    expect(projectRows(g, TODAY)[0].manager).toBeNull();
  });

  it("clamps a progress value that arrives out of range", () => {
    const odd = graphOf({
      projects: [
        { id: "a", name: "A", status: "active", progress: 140 },
        { id: "b", name: "B", status: "active", progress: -5 },
      ],
    });
    const rows = projectRows(odd, TODAY);
    expect(rows.map((r) => r.progress).sort((x, y) => x - y)).toEqual([0, 100]);
  });
});

describe("task buckets", () => {
  const g = graphOf({
    tasks: [
      { id: 1, status: "in_progress", due_date: day(30) },
      { id: 2, status: "pending", due_date: day(-1) },
      { id: 3, status: "in_progress", due_date: day(-4) },
      { id: 4, status: "rejected", due_date: day(10) },
      { id: 5, status: "pending", due_date: day(3) },
      { id: 6, status: "completed", due_date: day(-40) },
    ],
  });
  const b = taskBuckets(g, TODAY);

  it("does not count an already-late task as due soon", () => {
    // Task 3 is in progress AND overdue. Counting it in both buckets makes the
    // four tiles add up to more work than exists.
    expect(b.overdue.map((t) => t.id).sort()).toEqual([2, 3]);
    expect(b.due_soon.map((t) => t.id)).toEqual([5]);
  });

  it("counts in progress by status, including one that is also late", () => {
    expect(b.in_progress.map((t) => t.id).sort()).toEqual([1, 3]);
  });

  it("puts sent-back work in its own bucket", () => {
    expect(b.sent_back.map((t) => t.id)).toEqual([4]);
  });

  it("never counts finished work", () => {
    const all = [...b.in_progress, ...b.overdue, ...b.due_soon].map((t) => t.id);
    expect(all).not.toContain(6);
  });

  it("uses the documented horizon", () => {
    expect(SOON_DAYS).toBe(7);
    const edge = graphOf({
      tasks: [
        { id: "in", status: "pending", due_date: day(SOON_DAYS) },
        { id: "out", status: "pending", due_date: day(SOON_DAYS + 1) },
      ],
    });
    expect(taskBuckets(edge, TODAY).due_soon.map((t) => t.id)).toEqual(["in"]);
  });
});

describe("team and workload are one table", () => {
  const g = graphOf({
    projects: [{ id: "p1", name: "P1", status: "active", manager_id: "mgr" }],
    people: [
      { userId: "mgr", name: "Mina", role: "manager", status: "active" },
      { userId: "busy", name: "Bilal", role: "developer", status: "active" },
      { userId: "late", name: "Lena", role: "developer", status: "active" },
    ],
    tasks: [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `b${i}`,
        status: "pending",
        developer_id: "busy",
        project_id: "p1",
        due_date: day(20),
      })),
      { id: "l1", status: "pending", developer_id: "late", project_id: "p1", due_date: day(-2) },
    ],
  });

  it("puts the person in trouble above the person merely busy", () => {
    // Lena holds one task; Bilal holds five. Lena's is overdue. Sorting purely
    // by volume hides exactly the row somebody needs to act on.
    const rows = peopleRows(g, TODAY);
    expect(rows.map((r) => r.name)).toEqual(["Lena", "Bilal", "Mina"]);
  });

  it("counts a project somebody manages but holds no task on", () => {
    // A manager of three projects with no tasks of their own is not idle.
    const mina = peopleRows(g, TODAY).find((r) => r.name === "Mina");
    expect(mina.openTasks).toBe(0);
    expect(mina.projectCount).toBe(1);
  });

  it("gives every row a load word AND the count behind it", () => {
    // The thresholds are a convention, not a measurement — nothing records how
    // long a task takes — so the reader must be able to disagree with the word.
    for (const row of peopleRows(g, TODAY)) {
      expect(row.level?.label).toBeTruthy();
      expect(typeof row.openTasks).toBe("number");
    }
    const screen = read("src/components/admin/DashboardOverview.jsx");
    expect(screen).toMatch(/\{p\.openTasks\}/);
    expect(screen).toMatch(/p\.level\?\.label/);
  });
});

describe("the six headline numbers", () => {
  const g = graphOf({
    projects: [
      { id: "a", name: "A", status: "active", progress: 10, deadline: day(-1) },
      { id: "b", name: "B", status: "pending", progress: 0 },
      { id: "c", name: "C", status: "completed", progress: 100 },
    ],
    people: [
      { userId: "x", name: "X", role: "developer", status: "active" },
      { userId: "y", name: "Y", role: "developer", status: "suspended" },
    ],
    tasks: [{ id: 1, status: "pending", due_date: day(-3), developer_id: "x" }],
  });
  const proposals = [
    { id: 1, status: "submitted" },
    { id: 2, status: "in_review" },
    { id: 3, status: "needs_info" },
    { id: 4, status: "accepted" },
  ];
  const k = overviewKpis({ graph: g, proposals, today: TODAY });

  it("counts every project, and separately the ones still in flight", () => {
    expect(k.totalProjects).toBe(3);
    expect(k.activeProjects).toBe(2); // completed is not in flight
  });

  it("counts only proposals waiting on THIS side", () => {
    expect(k.pendingProposals).toBe(2); // not needs_info, not accepted
  });

  it("counts active memberships, not every row", () => {
    // A suspended member cannot sign in (orgContext.isMembershipActive), so
    // counting them as team size overstates who is actually available.
    expect(k.teamMembers).toBe(1);
  });

  it("counts overdue tasks and at-risk projects", () => {
    expect(k.overdueTasks).toBe(1);
    expect(k.atRiskProjects).toBe(1); // A: deadline passed
  });

  it("carries QA's three numbers, each from where it actually lives", () => {
    const qg = graphOf({
      tasks: [
        { id: 1, task_type: "bug", status: "pending" },
        { id: 2, task_type: "bug", status: "awaiting_approval" },
        { id: 3, task_type: "bug", status: "completed" },
        { id: 4, task_type: "feature", status: "pending" },
      ],
    });
    const qk = overviewKpis({ graph: qg, proposals: [], pendingReviews: 5, today: TODAY });

    expect(qk.openBugs).toBe(2); // completed is closed, the feature is not a bug
    expect(qk.bugsInQa).toBe(1); // awaiting_approval only

    // And they must be the SAME derivation the QA panel underneath renders.
    // Two counts of the same rows is two chances to disagree on one screen.
    expect(qk.openBugs).toBe(bugSummary(qg).open);
    expect(qk.bugsInQa).toBe(bugSummary(qg).inQa);

    // The review queue is not in the work graph at all — a submission is a
    // `task_submissions` row, not a `developer_tasks` row — so the loader
    // hands it in and this passes it through rather than deriving it.
    expect(qk.pendingReviews).toBe(5);
  });

  it("shows a zero, not a blank, for a count it was never given", () => {
    // withReviews and withClients are false for most roles, so these arrive
    // undefined. A tile rendering `undefined` prints nothing where a number
    // belongs, which reads as a broken card rather than an empty queue.
    expect(k.pendingReviews).toBe(0);
    expect(k.clientCount).toBe(0);
  });

  it("agrees with the table underneath it", () => {
    // Both come from one snapshot, which is the whole reason the loader exists.
    // If these two ever disagree, one panel is reading a different world.
    const rows = projectRows(g, TODAY);
    expect(rows.filter((r) => r.risks.length > 0).length).toBe(k.atRiskProjects);
    expect(rows.length).toBe(k.totalProjects);
  });
});

describe("date helpers", () => {
  it("counts whole days in both directions", () => {
    expect(daysUntil(day(3), TODAY)).toBe(3);
    expect(daysUntil(day(-3), TODAY)).toBe(-3);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });

  it("returns null for something that is not a date", () => {
    // A NaN reaching a comparison silently answers "false" to every question,
    // so a row with a broken date would quietly stop being overdue.
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil("not a date", TODAY)).toBeNull();
    expect(ymd("not a date")).toBeNull();
  });
});

describe("the screen tells the truth about what it is showing", () => {
  const SCREEN = read("src/components/admin/DashboardOverview.jsx");

  it("says when a list is truncated", () => {
    // A capped list that does not say it is capped reads as the whole set,
    // which is how somebody concludes there are five projects when there are
    // twelve.
    expect(SCREEN).toMatch(/Showing \{shown\} of \{count\}/);
  });

  it("hides links the viewer's role cannot follow", () => {
    // `overview` is visible to every admin-dashboard user including HR, who
    // cannot open All Projects. An unconditional link hands them a bounce,
    // which reads as the product being broken rather than as a permission.
    expect(SCREEN).toMatch(/canAccessAdminSection/);
    expect(SCREEN).toMatch(/canOpen=\{can\("all-projects"\)\}/);
    // The KPI row filters the catalogue by the same rule before rendering, so
    // every tile it draws is openable by construction.
    expect(SCREEN).toMatch(/KPI_CATALOGUE\.filter\(\(entry\) => can\(entry\.section\)\)/);
  });

  it("gates each PANEL on the section behind it, not just its link", () => {
    // A bug count HR cannot open is noise on a screen that is supposed to be
    // their dashboard. One rule — "show it if you could open it" — is what
    // makes three roles get three different, relevant screens.
    for (const [panel, section] of [
      ["ProjectsPanel", "all-projects"],
      ["TasksPanel", "views"],
      ["PeoplePanel", "capacity"],
      ["HierarchyPanel", "hierarchy"],
      ["ProposalsPanel", "requests"],
      ["QaPanel", "bugs"],
      ["ReportsPanel", "reports"],
    ]) {
      const re = new RegExp(`can\\("${section}"\\)[\\s\\S]{0,120}<${panel}`);
      expect(SCREEN, `${panel} must be gated on ${section}`).toMatch(re);
    }
    // These two are NOT gated, on purpose: the first is the reader's own
    // inbox, the second is org context that writes nothing.
    expect(SCREEN).toMatch(/\n +<NotificationsPanel/);
    expect(SCREEN).toMatch(/\n +<ActivityPanel/);
  });

  it("pauses its polling while nobody is looking", () => {
    expect(SCREEN).toMatch(/setVisibleInterval\(load, REFRESH_MS\)/);
  });
});
