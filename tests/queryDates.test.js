import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dateFromQuery, dateOnlyFromQuery, projectDetailsHref } from "@/utils/queryDates";

/**
 * The developer's default task plan came up with "Invalid Date" on every row.
 *
 * THE BUG: the staff dashboard built /developer/project-details?… with a
 * template literal, and the project's `created_at` / `assigned_at` are
 * Postgres timestamps with a `+00:00` offset. In a query string `+` is a
 * space, so the details page read `…12.123456 00:00`, `new Date()` of that is
 * invalid, and buildTasksFromTemplate seeded four tasks with no usable start
 * date. "End date is required" ×4, and the plan could not be saved without
 * editing each task. Found by e2e/developer.spec.js, not by a person — every
 * seeded project has an offset on its timestamps, so every developer had it.
 */

const source = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("dateFromQuery — a timestamp that came through a query string", () => {
  it("passes a well-formed timestamp through unchanged", () => {
    expect(dateFromQuery("2026-09-04T17:58:12.123456+00:00")).toBe("2026-09-04T17:58:12.123456+00:00");
    expect(dateFromQuery("2026-09-04")).toBe("2026-09-04");
  });

  it("repairs the offset whose `+` was decoded to a space", () => {
    expect(dateFromQuery("2026-09-04T17:58:12.123456 00:00")).toBe("2026-09-04T17:58:12.123456+00:00");
    expect(new Date(dateFromQuery("2026-09-04T17:58:12.123456 00:00")).getTime()).not.toBeNaN();
  });

  it("answers null for nothing, for the strings 'null'/'undefined', and for junk", () => {
    for (const v of [null, undefined, "", "  ", "null", "undefined", "not a date", "2026-13-45 99:99"]) {
      expect(dateFromQuery(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("dateOnlyFromQuery — the calendar day the task plan starts on", () => {
  it("reduces a timestamp to its UTC calendar day, so addDays() of it is never 'before' it", () => {
    expect(dateOnlyFromQuery("2026-09-04T17:58:12.123456+00:00")).toBe("2026-09-04");
    expect(dateOnlyFromQuery("2026-09-04T17:58:12.123456 00:00")).toBe("2026-09-04");
    // A same-day end (what the default plan writes) is no longer earlier than the start.
    const start = dateOnlyFromQuery("2026-09-04T17:58:12+00:00");
    expect(new Date("2026-09-04").getTime() >= new Date(start).getTime()).toBe(true);
  });

  it("leaves a date-only value alone and answers null for junk", () => {
    expect(dateOnlyFromQuery("2026-09-04")).toBe("2026-09-04");
    expect(dateOnlyFromQuery("null")).toBeNull();
    expect(dateOnlyFromQuery("nope")).toBeNull();
  });
});

describe("projectDetailsHref — the link the staff dashboard pushes", () => {
  const project = {
    id: "p-1",
    name: "QA & Friends",
    description: "a+b=c",
    status: "active",
    progress: 40,
    deadline: "2026-10-04",
    created_at: "2026-09-04T17:58:12.123456+00:00",
    assigned_at: "2026-09-04T18:00:00+00:00",
    file_url: null,
    file_name: "spec v2.pdf",
    assigned_developer_name: "QA Developer",
    assigned_developer_email: "dev@example.com",
  };

  it("round-trips every timestamp through URLSearchParams intact", () => {
    const href = projectDetailsHref(project);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("created_at")).toBe(project.created_at);
    expect(params.get("assigned_at")).toBe(project.assigned_at);
    expect(params.get("deadline")).toBe(project.deadline);
    expect(new Date(params.get("created_at")).getTime()).not.toBeNaN();
    // …and the fields that were already encoded still are.
    expect(params.get("name")).toBe("QA & Friends");
    expect(params.get("description")).toBe("a+b=c");
    expect(params.get("file_name")).toBe("spec v2.pdf");
    expect(params.get("file_url")).toBe("");
  });

  it("is what the staff dashboard actually uses — no raw template literal is left", () => {
    const src = source("src/app/developer/dashboard/page.jsx");
    expect(src).toContain("projectDetailsHref(project)");
    expect(src).not.toMatch(/created_at=\$\{project\.created_at\}/);
    expect(src).not.toMatch(/assigned_at=\$\{project\.assigned_at/);
  });

  it("is read back through dateFromQuery on the details page", () => {
    const src = source("src/app/developer/project-details/page.jsx");
    expect(src).toContain('import { dateOnlyFromQuery } from "@/utils/queryDates"');
    expect(src).toMatch(/dateOnlyFromQuery\(project\.assigned_at\)/);
    expect(src).toMatch(/dateOnlyFromQuery\(project\.created_at\)/);
  });
});
