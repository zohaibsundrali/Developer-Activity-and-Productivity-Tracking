import { describe, it, expect, vi } from "vitest";
vi.mock("@/utils/supabaseClient", () => ({ supabase: {} }));
import {
  overviewDay,
  overviewDuration,
  overviewWork,
  loadOverviewTasks,
} from "@/utils/developerOverview";
const org = "11111111-1111-4111-8111-111111111111",
  person = "22222222-2222-4222-8222-222222222222";
const identity = { organizationId: org, profileId: person };
function client(pages) {
  const calls = [];
  return {
    calls,
    from: vi.fn(() => {
      const q = {
        select: () => q,
        eq: (...args) => {
          calls.push(args);
          return q;
        },
        order: () => q,
        range: vi.fn(async () => pages.shift()),
      };
      return q;
    }),
  };
}
describe("developer overview", () => {
  it("uses the workspace day before UTC midnight", () => {
    expect(
      overviewDay(new Date("2026-09-19T21:00:00Z"), "Asia/Karachi"),
    ).toEqual({
      day: "2026-09-20",
      timezone: "Asia/Karachi",
      start: "2026-09-19T19:00:00.000Z",
      end: "2026-09-20T19:00:00.000Z",
    });
  });
  it.each([
    ["2026-03-29", 23],
    ["2026-10-25", 25],
  ])("respects DST on %s", (date, hours) => {
    const day = overviewDay(new Date(date + "T12:00:00Z"), "Europe/Berlin");
    expect((Date.parse(day.end) - Date.parse(day.start)) / 3600000).toBe(hours);
  });
  it("falls back to UTC for an invalid timezone", () =>
    expect(overviewDay(new Date("2026-09-20"), "bad-zone").timezone).toBe(
      "UTC",
    ));
  it("formats saved seconds without inventing elapsed time", () => {
    expect(overviewDuration(3661.9)).toBe("01:01:01");
    expect(overviewDuration(0)).toBe("00:00:00");
    for (const n of [null, undefined, -1, NaN, Infinity, "60"])
      expect(overviewDuration(n)).toBe("—");
  });
  it("deduplicates urgent work and excludes review/completed tasks from open totals", () => {
    const tasks = [
      { id: "a", status: "rejected", end_date: "2026-09-01" },
      { id: "b", status: "in_progress", end_date: "2026-09-19" },
      { id: "c", status: "pending", end_date: "2026-09-20" },
      { id: "d", status: "awaiting_approval" },
      { id: "e", status: "completed" },
      { id: "f", status: "pending" },
    ];
    const w = overviewWork(tasks, "2026-09-20");
    expect(w.total).toBe(4);
    expect(w.attention.map((x) => x.task.id)).toEqual(["a", "b", "c"]);
    expect(w.dueToday).toBe(1);
    expect(w.counts.in_review).toBe(1);
    expect(w.completed).toBe(1);
  });
  it("loads all scoped tasks across server pages", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: String(i),
      organization_id: org,
      developer_id: person,
    }));
    const c = client(
      [rows.slice(0, 500), rows.slice(500, 1000), rows.slice(1000)].map(
        (data) => ({ data, count: 1001 }),
      ),
    );
    expect(await loadOverviewTasks(c, identity)).toHaveLength(1001);
    expect(c.calls).toEqual(
      Array.from({ length: 3 }, () => [
        ["organization_id", org],
        ["developer_id", person],
      ]).flat(),
    );
  });
  it.each([
    { data: [], count: 1 },
    { data: [], count: null },
    { data: null, error: { message: "denied" } },
    {
      data: [{ id: "a", organization_id: "other", developer_id: person }],
      count: 1,
    },
  ])(
    "rejects incomplete/foreign data rather than showing zero",
    async (page) => {
      await expect(
        loadOverviewTasks(client([page]), identity),
      ).rejects.toThrow();
    },
  );
  it("rejects changing counts between pages", async () => {
    await expect(
      loadOverviewTasks(
        client([
          {
            data: [{ id: "a", organization_id: org, developer_id: person }],
            count: 2,
          },
          { data: [], count: 3 },
        ]),
        identity,
      ),
    ).rejects.toThrow();
  });
  it("ignores a response after the account unmounts", async () => {
    let active = true;
    const c = client([{ data: [], count: 0 }]);
    const pending = loadOverviewTasks(c, identity, () => active);
    active = false;
    expect(await pending).toBeNull();
  });
});
