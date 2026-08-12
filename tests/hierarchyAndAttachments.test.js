import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLES } from "@/utils/roles";
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
    }
  });

  it("is not visible to a developer, a designer or a client", () => {
    for (const role of ["developer", "designer", "client"]) {
      expect(canAccessAdminSection("hierarchy", role), role).toBe(false);
    }
  });

  it("names a real role list rather than being left open by omission", () => {
    // An id missing from ADMIN_SECTION_ROLES is allowed for EVERYONE by
    // canAccessAdminSection's `undefined` branch. That is the failure mode.
    expect(ADMIN_SECTION_ROLES.hierarchy).toBeDefined();
    expect(Array.isArray(ADMIN_SECTION_ROLES.hierarchy)).toBe(true);
  });
});

describe("the hierarchy derives a team without a query per project", () => {
  it("issues exactly five queries for the whole page", () => {
    // Counted, not claimed. The comment on this file first said "four" while
    // the code called loadEmployees() — which reads like one call and is SEVEN
    // (memberships, developers, admin_users, employee_profiles, teams,
    // departments, projects). The real number was nine. A helper that hides
    // its cost is how a page ends up slow while every line looks cheap.
    const tables = [...HIERARCHY.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(
      ["admin_users", "developer_tasks", "developers", "memberships", "projects"].sort()
    );
    expect(HIERARCHY).toContain("Promise.all");
    expect(HIERARCHY).toContain("tasksByProject");
  });

  it("does not call loadEmployees, whose cost is invisible at the call site", () => {
    expect(HIERARCHY).not.toContain("loadEmployees");
  });

  it("does not fetch inside the per-project map", () => {
    // The shape that kills this screen: `.map(async p => await supabase…)`.
    const shaped = HIERARCHY.slice(HIERARCHY.indexOf("const shaped ="));
    expect(shaped).not.toMatch(/\.map\(\s*async/);
    expect(shaped).not.toContain("await supabase");
  });

  it("unions all three ways somebody is on a project", () => {
    expect(HIERARCHY).toContain("p.manager_id");
    expect(HIERARCHY).toContain("p.assigned_developer_id");
    expect(HIERARCHY).toMatch(/for \(const t of tasks\)[\s\S]{0,120}t\.developer_id/);
  });

  it("does not list the manager twice", () => {
    // They are rendered above the team, on their own — that IS the hierarchy.
    expect(HIERARCHY).toMatch(/members\.delete\(String\(manager\.userId\)\)/);
  });

  it("counts a person once but sums their tasks", () => {
    // Somebody holding four tasks is one team member, not four.
    expect(HIERARCHY).toMatch(/seen\.taskCount \+= taskCount/);
  });

  it("takes progress from the same function the Project Hub uses", () => {
    // Two different progress numbers on two screens is worse than none.
    expect(HIERARCHY).toContain("computeProjectHealth");
    expect(HIERARCHY).not.toMatch(/done \/ total/);
  });

  it("reads the shared status vocabulary rather than a fourth map", () => {
    expect(HIERARCHY).toContain("projectStatusMeta");
    expect(HIERARCHY).not.toMatch(/const PROJECT_STATUS = \{/);
  });

  it("says so when a project has no manager, instead of showing a blank", () => {
    expect(HIERARCHY).toMatch(/No project manager set/);
    expect(HIERARCHY).toMatch(/Nobody is on this project yet/);
  });

  it("puts projects with no manager in their own section, above the rest", () => {
    // A stat tile counts them; this is where you see which ones. Split rather
    // than sorted, because a project nobody answers for is a different kind of
    // row and reads as just another card when mixed in.
    expect(HIERARCHY).toContain("const unmanaged = useMemo");
    expect(HIERARCHY).toContain("const managed = useMemo");
    expect(HIERARCHY).toMatch(/Without a manager/);
    // Both must EXIST before the ordering means anything. Comparing raw
    // indexOf results lets a missing needle return -1 and satisfy "comes
    // first" — the assertion then passes precisely when the feature is gone.
    const at = (needle) => {
      const i = HIERARCHY.indexOf(needle);
      expect(i, `${needle} is not rendered at all`).toBeGreaterThan(-1);
      return i;
    };
    expect(at("unmanaged.map(")).toBeLessThan(at("{managed.map("));
  });

  it("hides that section when there is nothing wrong, rather than showing an empty box", () => {
    expect(HIERARCHY).toMatch(/\{unmanaged\.length > 0 && \(/);
  });

  it("gives the progress bar an accessible value, not just a width", () => {
    expect(HIERARCHY).toContain('role="progressbar"');
    expect(HIERARCHY).toContain("aria-valuenow={pct}");
  });

  it("clamps a progress value that is out of range or not a number", () => {
    expect(HIERARCHY).toMatch(/Math\.max\(0, Math\.min\(100, Math\.round\(Number\(value\) \|\| 0\)\)\)/);
  });

  it("drives the collapse from aria-expanded and aria-controls", () => {
    expect(HIERARCHY).toContain("aria-expanded={expanded}");
    expect(HIERARCHY).toContain("aria-controls={panelId}");
  });

  it("writes nothing — it is a read-only view", () => {
    // Scoped to supabase chains on purpose: a bare /\.delete\(/ also matches
    // `next.delete(id)`, which is the expand/collapse Set and not a write. A
    // test that fails on a Set is a test people learn to ignore.
    const calls = HIERARCHY.match(/supabase\s*\.from\([\s\S]{0,400}?(?=supabase\s*\.from\(|$)/g) || [];
    expect(calls.length, "no supabase calls found — the check would be vacuous").toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
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
