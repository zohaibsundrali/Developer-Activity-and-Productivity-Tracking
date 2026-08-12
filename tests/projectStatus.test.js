import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PROJECT_STATUSES,
  PROJECT_STATUS_IDS,
  PROJECT_STATUS,
  LEGACY_SPELLINGS,
  normalizeProjectStatus,
  isProjectStatus,
  projectStatusMeta,
  isProjectFinished,
  isProjectOpen,
} from "@/utils/projectStatus";

/**
 * One vocabulary for projects.status.
 *
 * The column had NO constraint — 'zzz_still_not_a_status' inserted into the
 * live table and came back 201 — and four screens had grown their own maps of
 * what the values meant, which did not agree. Eleven spellings for six states.
 *
 * What has to stay true now:
 *   1. The module and migration 065 name the SAME six. A status the app can
 *      write and the database refuses is a save that fails in front of a user.
 *   2. Every old spelling still READS. Rows written before the constraint, and
 *      anything imported around the app, must not render as "Unknown".
 *   3. An unrecognised value is shown, never relabelled. The old developer
 *      dashboard called anything it did not know "Pending", which is how a bad
 *      value hides in plain sight.
 *   4. Nothing writes a bare string any more.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("--"))
    .join("\n");

const MIGRATION = read("database/065_project_status_vocabulary.sql");
const MIGRATION_CODE = code("database/065_project_status_vocabulary.sql");

const CANONICAL = ["pending", "active", "on_hold", "completed", "closed", "cancelled"];

describe("the vocabulary", () => {
  it("is the six states, and only those", () => {
    expect([...PROJECT_STATUS_IDS].sort()).toEqual([...CANONICAL].sort());
  });

  it("gives every status a label and a tone", () => {
    for (const s of PROJECT_STATUSES) {
      expect(s.label, `${s.id} label`).toBeTruthy();
      expect(s.tone, `${s.id} tone`).toBeTruthy();
    }
  });

  it("has no two statuses sharing a label", () => {
    // Two states rendering the same word is the duplication this replaced.
    const labels = PROJECT_STATUSES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("exposes write constants derived from the table, not typed out", () => {
    expect(Object.keys(PROJECT_STATUS).sort()).toEqual([...CANONICAL].sort());
    for (const id of PROJECT_STATUS_IDS) expect(PROJECT_STATUS[id]).toBe(id);
    expect(code("src/utils/projectStatus.js")).toMatch(/PROJECT_STATUS = Object\.freeze/);
  });
});

describe("the database agrees with the module", () => {
  it("constrains exactly the six the module names", () => {
    const check = MIGRATION_CODE.match(
      /add constraint projects_status_check\s*check \(status is null or status in\s*\(([^)]*)\)\)/
    );
    expect(check, "the CHECK could not be found").toBeTruthy();
    const inSql = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...CANONICAL].sort());
  });

  it("folds every legacy spelling the module folds", () => {
    // A spelling the module folds but the migration does not would survive in
    // the database and then fail the CHECK.
    for (const [from, to] of Object.entries(LEGACY_SPELLINGS)) {
      expect(MIGRATION_CODE, `${from} is not folded in SQL`).toContain(`when '${from}'`);
      expect(
        MIGRATION_CODE.match(new RegExp(`when '${from}'\\s+then '${to}'`)),
        `${from} -> ${to} disagrees between SQL and JS`
      ).toBeTruthy();
    }
  });

  it("folds before it constrains", () => {
    // The CHECK is validated against existing rows the moment it is added, so
    // a single stale spelling aborts it. Proven on postgres:16: adding the
    // constraint to the unfolded fixture failed with "is violated by some row".
    expect(MIGRATION_CODE.indexOf("update public.projects")).toBeLessThan(
      MIGRATION_CODE.indexOf("add constraint projects_status_check")
    );
  });

  it("surveys what is there before it writes anything", () => {
    const survey = MIGRATION_CODE.indexOf("group by 1");
    expect(survey).toBeGreaterThan(-1);
    expect(survey).toBeLessThan(MIGRATION_CODE.indexOf("update public.projects"));
  });

  it("verifies on the COLUMN, not on the text of the definition", () => {
    // 063 shipped `pg_get_constraintdef(oid) ilike '%status%'`, which matched
    // projects_task_plan_status_check — a constraint on a different column —
    // and read as a false all-clear.
    expect(MIGRATION).toContain("unnest(con.conkey)");
    expect(MIGRATION).toMatch(/a\.attname = 'status'/);
    expect(MIGRATION_CODE).not.toMatch(/pg_get_constraintdef\(oid\) ilike/);
  });

  it("leaves the column nullable", () => {
    expect(MIGRATION_CODE).toMatch(/check \(status is null or status in/);
    expect(MIGRATION_CODE).not.toMatch(/alter column status set not null/i);
  });
});

describe("normalizeProjectStatus", () => {
  it("passes the canonical six through", () => {
    for (const id of CANONICAL) expect(normalizeProjectStatus(id)).toBe(id);
  });

  it("folds every legacy spelling", () => {
    expect(normalizeProjectStatus("in_progress")).toBe("active");
    expect(normalizeProjectStatus("in progress")).toBe("active");
    expect(normalizeProjectStatus("done")).toBe("completed");
    expect(normalizeProjectStatus("on hold")).toBe("on_hold");
    expect(normalizeProjectStatus("canceled")).toBe("cancelled");
    expect(normalizeProjectStatus("archived")).toBe("closed");
  });

  it("folds `assigned` to pending, not active", () => {
    // Handed to somebody who has not started it is not in progress.
    expect(normalizeProjectStatus("assigned")).toBe("pending");
  });

  it("is case- and space-insensitive, like the SQL fold", () => {
    expect(normalizeProjectStatus("  Active  ")).toBe("active");
    expect(normalizeProjectStatus("IN PROGRESS")).toBe("active");
  });

  it("returns null for something that is not a status", () => {
    // Not a default. Quietly relabelling a typo as a real status is how it
    // becomes a project that looks fine and is not.
    expect(normalizeProjectStatus("zzz_still_not_a_status")).toBeNull();
    expect(normalizeProjectStatus("")).toBeNull();
    expect(normalizeProjectStatus("   ")).toBeNull();
    expect(normalizeProjectStatus(null)).toBeNull();
    expect(normalizeProjectStatus(undefined)).toBeNull();
  });

  it("does not accept a legacy spelling as writable", () => {
    // It reads. The database now refuses it.
    expect(isProjectStatus("in_progress")).toBe(false);
    expect(isProjectStatus("active")).toBe(true);
  });
});

describe("projectStatusMeta", () => {
  it("always returns something usable, so no caller needs its own fallback", () => {
    for (const v of [null, undefined, "", "nonsense", "done", "active"]) {
      const m = projectStatusMeta(v);
      expect(m.label, String(v)).toBeTruthy();
      expect(m.tone, String(v)).toBeTruthy();
    }
  });

  it("shows an unknown value rather than calling it Pending", () => {
    const m = projectStatusMeta("zzz_still_not_a_status");
    expect(m.unknown).toBe(true);
    expect(m.tone).toBe("unknown");
    expect(m.label).toBe("Zzz Still Not A Status");
    expect(m.label).not.toBe("Pending");
  });

  it("gives a legacy spelling the canonical label", () => {
    expect(projectStatusMeta("in_progress").label).toBe("Active");
    expect(projectStatusMeta("done").label).toBe("Completed");
  });
});

describe("isProjectFinished / isProjectOpen", () => {
  it("treats completed and closed as finished", () => {
    expect(isProjectFinished("completed")).toBe(true);
    expect(isProjectFinished("closed")).toBe(true);
    expect(isProjectFinished("done")).toBe(true);
    expect(isProjectFinished("active")).toBe(false);
  });

  it("counts an UNKNOWN status as open", () => {
    // Whatever it is, it is not finished. Treating it as finished would drop
    // it out of every "what is left" list — the one place somebody might have
    // noticed the bad value.
    expect(isProjectOpen("zzz_still_not_a_status")).toBe(true);
    expect(isProjectOpen(null)).toBe(true);
  });

  it("does not count a cancelled project as open", () => {
    expect(isProjectOpen("cancelled")).toBe(false);
    expect(isProjectFinished("cancelled")).toBe(false);
  });
});

describe("every writer uses the constant, never a literal", () => {
  const WRITERS = [
    "src/components/admin/AllProjects.jsx",
    "src/app/api/proposals/[id]/decide/route.js",
    "src/utils/pmData.js",
    "src/app/api/projects/[id]/closure/route.js",
  ];

  it("imports the vocabulary in each of the four", () => {
    for (const f of WRITERS) {
      expect(code(f), `${f} does not import it`).toContain(
        'from "@/utils/projectStatus"'
      );
    }
  });

  it("no longer writes in_progress anywhere — the CHECK refuses it", () => {
    // The closure route's reopen wrote it. That save would now fail.
    const closure = code("src/app/api/projects/[id]/closure/route.js");
    expect(closure).not.toMatch(/status:\s*["']in_progress["']/);
    expect(closure).toContain("PROJECT_STATUS.active");
  });

  it("leaves the TASK pipeline alone", () => {
    // developer_tasks has its own statuses (awaiting_approval, rejected) and
    // shares none of this. cloneProject writes both in one function, and only
    // the project row was changed.
    const pm = code("src/utils/pmData.js");
    expect(pm).toMatch(/project_id: proj\.id,\s*\n\s*status: "pending"/);
    expect(pm).toContain("status: PROJECT_STATUS.pending");
  });
});

describe("the reader maps are gone", () => {
  it("developer MyProjects reads the shared vocabulary", () => {
    const f = code("src/components/developer/MyProjects.jsx");
    expect(f).toContain("projectStatusMeta");
    expect(f).not.toMatch(/const PROJECT_STATUS = \{/);
  });

  it("developer DashboardOverview reads it too, and stopped hiding bad values", () => {
    const f = code("src/components/developer/DashboardOverview.jsx");
    expect(f).toContain("projectStatusMeta");
    expect(f).not.toMatch(/const PROJECT_STATUS = \{/);
    // The old fallback.
    expect(f).not.toMatch(/\|\| \{ status: "pending", label: "Pending" \}/);
  });
});
