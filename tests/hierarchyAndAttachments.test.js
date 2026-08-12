import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLES } from "@/utils/roles";
import {
  projectTeam,
  personLoad,
  loadLevel,
  LOAD_LEVELS,
  isOpenTask,
} from "@/utils/orgWorkGraph";
import {
  ROLE_META,
  ROLE_VARIANTS,
  roleIcon,
  roleLabel,
  rolePlural,
  roleVariant,
  roleOrder,
} from "@/components/shared/roleMeta";
import { ADMIN_NAV, ADMIN_SECTION_ROLES, canAccessAdminSection } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";

/**
 * Team Structure, and the attachments that could not be opened.
 *
 * TWO THINGS THIS PINS
 *
 * 1. The hierarchy screen derives a project's team, because there is no
 *    `project_members` table. It unions three facts — manager_id, the legacy
 *    single assigned_developer_id, and anyone holding a task — and it must do
 *    that in ONE pass over the org rather than a query per project, which is
 *    what makes a screen like this unusable on real data.
 *
 * 2. Attachments were uploaded into a PRIVATE bucket and listed by name only.
 *    There was no way to open one and no way to delete one, so every upload
 *    was write-only. The signing helper and the delete order are the fix.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

const HIERARCHY = code("src/components/admin/ProjectHierarchy.jsx");
const PMDATA = code("src/utils/pmData.js");
const DRAWER = code("src/components/admin/TaskDetailDrawer.jsx");

describe("role presentation lives in one place", () => {
  it("covers every role, so none renders as a stranger", () => {
    for (const r of ROLES) {
      expect(ROLE_META[r], `${r} has no icon/label`).toBeTruthy();
      expect(ROLE_VARIANTS[r], `${r} has no badge variant`).toBeTruthy();
    }
  });

  it("gives an unknown role a usable icon and label rather than throwing", () => {
    expect(() => roleIcon("wizard")).not.toThrow();
    expect(roleIcon("wizard")).toBeTruthy();
    expect(roleLabel("wizard")).toBe("Wizard");
    expect(rolePlural("team_lead")).toBe("Team Leads");
    expect(roleVariant("wizard")).toBe("outline");
  });

  it("sorts an unknown role after the known ones instead of dropping it", () => {
    // An unrecognised role is the one clue that something granted it.
    expect(roleOrder("wizard")).toBeGreaterThan(roleOrder("employee"));
    expect(roleOrder("owner")).toBeLessThan(roleOrder("developer"));
  });

  it("keeps HR and QA as initialisms in the plural", () => {
    expect(rolePlural("hr")).toBe("HR");
    expect(rolePlural("qa")).toBe("QA");
  });

  it("is not redefined inside the directory it came from", () => {
    const dir = code("src/components/admin/EmployeeDirectory.jsx");
    expect(dir).toContain('from "@/components/shared/roleMeta"');
    expect(dir).not.toMatch(/const ROLE_VARIANTS = \{/);
    expect(dir).not.toMatch(/const ROLE_META = \{/);
  });

  it("stays out of any API route — it imports lucide", () => {
    // utils/roles.js is the pure one the server uses. If a route ever imports
    // this, the server build pulls in an icon library.
    const meta = read("src/components/shared/roleMeta.js");
    expect(meta).toContain("lucide-react");
    expect(code("src/app/api/auth/provision/route.js")).not.toContain("roleMeta");
  });
});

describe("the Team Structure section is wired end to end", () => {
  it("is in the sidebar with a title and a component", () => {
    expect(ADMIN_NAV.map((i) => i.id)).toContain("hierarchy");
    expect(SECTION_TITLES.hierarchy?.admin).toBe("Team Structure");
    expect(code("src/app/admin/dashboard/page.js")).toContain('case "hierarchy":');
  });

  it("is visible to founder, admin, HR, PM and team lead — the five who were asked for", () => {
    for (const role of ["owner", "admin", "hr", "manager", "team_lead"]) {
      expect(canAccessAdminSection("hierarchy", role), role).toBe(true);
      expect(canAccessAdminSection("capacity", role), role).toBe(true);
    }
  });

  it("wires Capacity the same way, end to end", () => {
    expect(ADMIN_NAV.map((i) => i.id)).toContain("capacity");
    expect(SECTION_TITLES.capacity?.admin).toBe("Capacity");
    expect(code("src/app/admin/dashboard/page.js")).toContain('case "capacity":');
    // Missing from ADMIN_SECTION_ROLES means allowed for EVERYONE, via
    // canAccessAdminSection's `undefined` branch. That is the failure mode.
    expect(ADMIN_SECTION_ROLES.capacity).toBeDefined();
  });

  it("is not visible to a developer, a designer or a client", () => {
    for (const role of ["developer", "designer", "client"]) {
      expect(canAccessAdminSection("hierarchy", role), role).toBe(false);
      expect(canAccessAdminSection("capacity", role), role).toBe(false);
    }
  });

  it("names a real role list rather than being left open by omission", () => {
    // An id missing from ADMIN_SECTION_ROLES is allowed for EVERYONE by
    // canAccessAdminSection's `undefined` branch. That is the failure mode.
    expect(ADMIN_SECTION_ROLES.hierarchy).toBeDefined();
    expect(Array.isArray(ADMIN_SECTION_ROLES.hierarchy)).toBe(true);
  });
});

describe("the work graph — one loader, five queries, no per-project fetch", () => {
  const GRAPH_SRC = code("src/utils/orgWorkGraph.js");

  it("issues exactly five queries, and they are these five", () => {
    // Counted, not claimed. This screen first called loadEmployees(), which
    // reads like one call and is SEVEN (memberships, developers, admin_users,
    // employee_profiles, teams, departments, projects). The real number was
    // nine. A helper whose cost is invisible at the call site is how a page
    // ends up slow while every line in it looks cheap.
    const tables = [...GRAPH_SRC.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(
      ["admin_users", "developer_tasks", "developers", "memberships", "projects"].sort()
    );
    expect(GRAPH_SRC).toContain("Promise.all");
  });

  it("is the only place the screens fetch from", () => {
    // Two copies of the joining rules would drift into two screens disagreeing
    // about who is on a project — each looking right on its own.
    for (const f of [
      "src/components/admin/ProjectHierarchy.jsx",
      "src/components/admin/TeamCapacity.jsx",
    ]) {
      const src = code(f);
      expect(src, `${f} fetches directly`).not.toMatch(/supabase\s*\.from\(/);
      expect(src, `${f} uses the seven-query helper`).not.toContain("loadEmployees");
      expect(src).toContain("loadOrgWorkGraph");
    }
  });

  it("never fetches inside a per-project or per-person map", () => {
    for (const f of [
      "src/utils/orgWorkGraph.js",
      "src/components/admin/ProjectHierarchy.jsx",
      "src/components/admin/TeamCapacity.jsx",
    ]) {
      const src = code(f);
      const after = src.slice(src.indexOf("loadOrgWorkGraph"));
      expect(after, f).not.toMatch(/\.map\(\s*async/);
    }
  });

  it("writes nothing — both screens are read-only", () => {
    // Scoped to supabase chains: a bare /\.delete\(/ also matches
    // `next.delete(id)`, the expand/collapse Set. A test that fails on a Set is
    // one people learn to ignore.
    const calls = GRAPH_SRC.match(/supabase\s*\.from\([\s\S]{0,400}?(?=supabase\s*\.from\(|$)/g) || [];
    expect(calls.length, "no supabase calls found — the check would be vacuous").toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("projectTeam — the three ways somebody is on a project", () => {
  const graph = {
    projects: [],
    projectById: new Map(),
    tasksByProject: new Map([
      [
        "p1",
        [
          { id: "t1", project_id: "p1", developer_id: "dev", status: "pending" },
          { id: "t2", project_id: "p1", developer_id: "dev", status: "in_progress" },
          { id: "t3", project_id: "p1", developer_id: "des", status: "pending" },
        ],
      ],
    ]),
    tasksByPerson: new Map(),
    personById: new Map([
      ["pm", { userId: "pm", name: "Pat", email: "pat@x.com", role: "manager" }],
      ["dev", { userId: "dev", name: "Dev", email: "dev@x.com", role: "developer" }],
      ["des", { userId: "des", name: "Des", email: "des@x.com", role: "designer" }],
      ["leg", { userId: "leg", name: "Leg", email: "leg@x.com", role: "developer" }],
    ]),
    personByEmail: new Map([["leg@x.com", { userId: "leg", name: "Leg", email: "leg@x.com", role: "developer" }]]),
  };

  it("includes anyone holding a task", () => {
    const { team } = projectTeam({ id: "p1" }, graph);
    expect(team.map((t) => t.userId).sort()).toEqual(["des", "dev"]);
  });

  it("counts a person once but sums their tasks", () => {
    // Somebody holding two tasks is one team member, not two.
    const { team } = projectTeam({ id: "p1" }, graph);
    expect(team.find((t) => t.userId === "dev").taskCount).toBe(2);
    expect(team.filter((t) => t.userId === "dev")).toHaveLength(1);
  });

  it("includes the legacy single assignee, by id or by email", () => {
    const byId = projectTeam({ id: "p1", assigned_developer_id: "leg" }, graph);
    expect(byId.team.map((t) => t.userId)).toContain("leg");

    const byEmail = projectTeam({ id: "p1", assigned_developer_email: "LEG@x.com" }, graph);
    expect(byEmail.team.map((t) => t.userId)).toContain("leg");
  });

  it("returns the manager separately and keeps them OUT of the team", () => {
    // Every screen renders them above it. In both places, a two-person project
    // reports three people.
    const r = projectTeam({ id: "p1", manager_id: "pm" }, graph);
    expect(r.manager.userId).toBe("pm");
    expect(r.team.map((t) => t.userId)).not.toContain("pm");
  });

  it("does not double-count a manager who also holds tasks", () => {
    const r = projectTeam({ id: "p1", manager_id: "dev" }, graph);
    expect(r.manager.userId).toBe("dev");
    expect(r.team.map((t) => t.userId)).not.toContain("dev");
  });

  it("survives a project with no team, no manager and no tasks", () => {
    const r = projectTeam({ id: "nope" }, graph);
    expect(r.team).toEqual([]);
    expect(r.manager).toBeNull();
    expect(r.tasks).toEqual([]);
  });
});

describe("personLoad — what one person is carrying", () => {
  const TODAY = "2026-08-12";
  const graph = {
    projects: [
      { id: "p1", manager_id: "pm" },
      { id: "p2", manager_id: null },
      { id: "p3", manager_id: "pm" },
    ],
    projectById: new Map(),
    tasksByProject: new Map(),
    tasksByPerson: new Map([
      [
        "dev",
        [
          { id: "a", project_id: "p1", developer_id: "dev", status: "pending", due_date: "2026-08-01" },
          { id: "b", project_id: "p1", developer_id: "dev", status: "in_progress", due_date: "2026-12-01" },
          { id: "c", project_id: "p2", developer_id: "dev", status: "completed", due_date: "2026-01-01" },
          { id: "d", project_id: "p2", developer_id: "dev", status: "rejected", due_date: "2026-08-01" },
        ],
      ],
      ["pm", []],
    ]),
    personById: new Map(),
    personByEmail: new Map(),
  };

  it("counts only open work", () => {
    const l = personLoad({ userId: "dev" }, graph, TODAY);
    expect(l.totalTasks).toBe(4);
    expect(l.openTasks).toBe(3); // completed is off the plate; rejected is not
  });

  it("counts a REJECTED task as open — it is back on their plate", () => {
    // A capacity view that forgets this reports somebody as free while they
    // are fixing something.
    const l = personLoad({ userId: "dev" }, graph, TODAY);
    expect(l.tasks.map((t) => t.id)).toContain("d");
  });

  it("counts overdue only among open tasks", () => {
    // Task c is past due but completed, so it is not somebody's problem.
    const l = personLoad({ userId: "dev" }, graph, TODAY);
    expect(l.overdue).toBe(2); // a and d
  });

  it("counts distinct projects, not tasks", () => {
    const l = personLoad({ userId: "dev" }, graph, TODAY);
    expect(l.projectCount).toBe(2);
  });

  it("counts projects somebody MANAGES even with no tasks of their own", () => {
    // Managing three projects is not idle, and showing it as free is how work
    // lands on the wrong person.
    const l = personLoad({ userId: "pm" }, graph, TODAY);
    expect(l.openTasks).toBe(0);
    expect(l.managingCount).toBe(2);
    expect(l.projectCount).toBe(2);
  });

  it("survives somebody with no record at all", () => {
    const l = personLoad({ userId: "ghost" }, graph, TODAY);
    expect(l.openTasks).toBe(0);
    expect(l.projectCount).toBe(0);
  });
});

describe("loadLevel — a convention, ordered so the extremes surface", () => {
  it("calls nobody with no open work anything but free", () => {
    expect(loadLevel({ openTasks: 0, overdue: 0 }).id).toBe("free");
  });

  it("escalates with volume", () => {
    expect(loadLevel({ openTasks: 1, overdue: 0 }).id).toBe("light");
    expect(loadLevel({ openTasks: 4, overdue: 0 }).id).toBe("steady");
    expect(loadLevel({ openTasks: 7, overdue: 0 }).id).toBe("heavy");
    expect(loadLevel({ openTasks: 12, overdue: 0 }).id).toBe("overloaded");
  });

  it("lets overdue work outrank volume", () => {
    // Two overdue is a worse position than six on-time, and sorting purely by
    // count hides exactly that.
    expect(loadLevel({ openTasks: 1, overdue: 1 }).id).toBe("heavy");
    expect(loadLevel({ openTasks: 1, overdue: 3 }).id).toBe("overloaded");
  });

  it("ranks the levels so a sort is possible", () => {
    const ranks = ["free", "light", "steady", "heavy", "overloaded"].map(
      (id) => LOAD_LEVELS[id].rank
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("the Capacity screen", () => {
  const CAP = code("src/components/admin/TeamCapacity.jsx");

  it("leaves suspended members out of available capacity", () => {
    // Listing a locked-out account as "Free" is how work gets assigned to it.
    expect(CAP).toMatch(/filter\(\(p\) => p\.status === "active"\)/);
  });

  it("shows the raw counts beside the label that summarised them", () => {
    // The label is a convention, not a measurement — nothing here records how
    // long a task takes. A number presented as a verdict gets used as one.
    expect(CAP).toContain("load.openTasks");
    expect(CAP).toContain("load.overdue");
    expect(CAP).toMatch(/not hours/);
  });

  it("reuses the shared role and status metadata", () => {
    expect(CAP).toContain('from "@/components/shared/roleMeta"');
    expect(CAP).toContain("projectStatusMeta");
  });

  it("gives the load bar a text alternative, not just a width", () => {
    expect(CAP).toContain('role="progressbar"');
    expect(CAP).toContain("aria-valuetext");
  });
});

describe("attachments can now be opened and removed", () => {
  it("signs a URL, because the bucket is private", () => {
    expect(PMDATA).toContain("createSignedUrl");
    expect(PMDATA).toMatch(/export async function signTaskAttachment/);
  });

  it("deletes the ROW before the file", () => {
    // Row first leaves at worst an invisible orphaned blob. File first leaves a
    // listed attachment whose download 404s, which reads as a bug twice.
    const fn = PMDATA.slice(
      PMDATA.indexOf("export async function deleteTaskAttachment"),
      PMDATA.indexOf("export async function deleteTaskAttachment") + 900
    );
    const rowAt = fn.indexOf('from("task_attachments").delete()');
    const fileAt = fn.indexOf("storage.from(\"task-submissions\").remove");
    expect(rowAt).toBeGreaterThan(-1);
    expect(fileAt).toBeGreaterThan(-1);
    expect(rowAt).toBeLessThan(fileAt);
  });

  it("stops if the row delete fails, rather than orphaning the row's file", () => {
    const fn = PMDATA.slice(PMDATA.indexOf("export async function deleteTaskAttachment"));
    expect(fn).toMatch(/if \(error\) return \{ error \};/);
  });

  it("refuses an attachment with no stored path instead of signing nothing", () => {
    expect(PMDATA).toMatch(/if \(!path\) return \{ url: null, error/);
  });

  it("offers open and delete in the drawer", () => {
    expect(DRAWER).toContain("handleOpenAttachment");
    expect(DRAWER).toContain("handleDeleteAttachment");
    expect(DRAWER).toContain("signTaskAttachment");
    expect(DRAWER).toContain("deleteTaskAttachment");
  });

  it("confirms before deleting", () => {
    expect(DRAWER).toMatch(/showConfirm\([\s\S]{0,120}Delete this file/);
  });

  it("opens the window only after the URL comes back", () => {
    // Opening first and navigating later is what browsers block as a popup.
    const fn = DRAWER.slice(
      DRAWER.indexOf("const handleOpenAttachment"),
      DRAWER.indexOf("const handleDeleteAttachment")
    );
    expect(fn.indexOf("await signTaskAttachment")).toBeLessThan(fn.indexOf("window.open"));
  });

  it("checks the file size before uploading, not after the 413", () => {
    expect(DRAWER).toContain("MAX_ATTACHMENT_BYTES");
    expect(DRAWER).toMatch(/if \(file\.size > MAX_ATTACHMENT_BYTES\)/);
  });

  it("shows the size, so a 0-byte failed upload is distinguishable", () => {
    expect(DRAWER).toContain("formatBytes(a.file_size)");
  });

  it("gives both buttons an accessible name carrying the file name", () => {
    expect(DRAWER).toMatch(/aria-label=\{`Open \$\{name\}`\}/);
    expect(DRAWER).toMatch(/aria-label=\{`Delete \$\{name\}`\}/);
  });
});
