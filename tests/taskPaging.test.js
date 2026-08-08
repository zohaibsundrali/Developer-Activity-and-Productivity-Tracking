import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PostgREST caps a single response at 1000 rows and reports nothing, so an
 * unpaged `.select()` returns a partial set that the board then renders as if
 * it were the whole project. These cover the range walking that replaced it:
 * that every page is requested, that a short page ends the walk, and that
 * hitting the ceiling is reported rather than passed off as complete.
 */

let ranges;

vi.mock("@/utils/orgContext", () => ({
  getOrgId: () => "org-1",
  getOrgContext: () => ({ userId: "dev-1" }),
  isMembershipActive: () => true,
}));
vi.mock("@/utils/authFetch", () => ({ authFetch: vi.fn() }));

const TOTAL = { rows: 0 };
vi.mock("@/utils/supabaseClient", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    is: () => builder,
    order: () => builder,
    range: (from, to) => {
      ranges.push([from, to]);
      const slice = [];
      for (let i = from; i <= to && i < TOTAL.rows; i += 1) slice.push({ id: `row-${i}` });
      return Promise.resolve({ data: slice, error: null });
    },
  };
  return { supabase: { from: () => builder } };
});

const { loadTasks } = await import("@/utils/pmData");

beforeEach(() => {
  ranges = [];
});

describe("loadTasks paging", () => {
  it("returns everything when a project fits inside one page", async () => {
    TOTAL.rows = 250;
    const { tasks, truncated } = await loadTasks("project-1");
    expect(tasks).toHaveLength(250);
    expect(truncated).toBe(false);
    // A short page means there is no more data, so it must not ask again.
    expect(ranges).toEqual([[0, 999]]);
  });

  it("walks past the 1000-row cap that used to truncate silently", async () => {
    TOTAL.rows = 2500;
    const { tasks, truncated } = await loadTasks("project-1");
    expect(tasks).toHaveLength(2500);
    expect(truncated).toBe(false);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops exactly on a page boundary without a wasted request", async () => {
    TOTAL.rows = 2000;
    const { tasks } = await loadTasks("project-1");
    expect(tasks).toHaveLength(2000);
    // 2000 rows fill two pages, so a third request is needed to learn the walk
    // is over — but no fourth.
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("reports truncation instead of passing a partial set off as complete", async () => {
    TOTAL.rows = 50000;
    const { tasks, truncated } = await loadTasks("project-1");
    expect(tasks).toHaveLength(10000);
    expect(truncated).toBe(true);
  });

  it("never asks for more than the ceiling", async () => {
    TOTAL.rows = 50000;
    await loadTasks("project-1");
    const highest = Math.max(...ranges.map(([, to]) => to));
    expect(highest).toBeLessThan(10000);
  });

  it("returns an empty list rather than throwing when there is nothing", async () => {
    TOTAL.rows = 0;
    const { tasks, truncated, error } = await loadTasks("project-1");
    expect(tasks).toEqual([]);
    expect(truncated).toBe(false);
    expect(error).toBeNull();
  });
});
