import { describe, it, expect, vi } from "vitest";
vi.mock("@/utils/supabaseClient", () => ({ supabase: {} }));
import { reportDay, reportDaysBetween, reportDefaultRange, reportRangeBounds, reportRangeDays } from "../src/utils/reportDates";
import { dailyTrend } from "../src/utils/reportsData";

describe("UTC report calendar boundaries", () => {
  it.each(["Asia/Karachi", "America/New_York", "Europe/Berlin"])("is timezone-independent across DST in %s", (zone) => {
    const before = process.env.TZ;
    process.env.TZ = zone;
    try {
      const range = { from: "2026-03-07", to: "2026-03-10" };
      expect(reportRangeDays(range)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
      expect(reportRangeBounds(range)).toEqual({ fromIso: "2026-03-07T00:00:00.000Z", toIso: "2026-03-11T00:00:00.000Z" });
    } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  });
  it("includes fractional final seconds while excluding next midnight", () => {
    const range = { from: "2026-09-12", to: "2026-09-12" };
    const bounds = reportRangeBounds(range);
    expect(Date.parse("2026-09-12T23:59:59.999Z")).toBeLessThan(Date.parse(bounds.toIso));
    expect(Date.parse("2026-09-13T00:00:00Z")).toBe(Date.parse(bounds.toIso));
    const result = dailyTrend({ range, tasks: [], sessions: [], timeLogs: [
      { started_at: "2026-09-12T23:59:59.999Z", seconds: 3600 },
      { started_at: "2026-09-13T00:00:00Z", seconds: 7200 },
    ] });
    expect(result.days).toEqual(["2026-09-12"]);
    expect(result.loggedHours).toEqual([1]);
  });
  it.each([{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-03-02", to: "2026-03-01" }, { from: "2026-3-01", to: "2026-03-01" }, {}])("rejects invalid or reversed ranges %j", (range) => {
    expect(() => reportRangeBounds(range)).toThrow("Report dates");
  });
  it("rejects unsupported PostgreSQL years and unbounded chart allocations", () => {
    expect(() => reportRangeBounds({ from: "0000-01-01", to: "0000-01-02" })).toThrow();
    expect(() => reportRangeBounds({ from: "9999-12-31", to: "9999-12-31" })).toThrow("end date");
    expect(() => reportRangeDays({ from: "2000-01-01", to: "2026-01-01" })).toThrow("3660");
  });
  it("counts calendar days rather than rounded partial durations", () => {
    expect(reportDaysBetween("2026-09-11T23:59:59Z", "2026-09-12T00:00:01Z")).toBe(1);
    expect(reportDay(null)).toBeNull();
    expect(reportDay("2026-02-30")).toBeNull();
  });
  it("defaults to 30 inclusive UTC days and includes leap day", () => {
    const range = reportDefaultRange(new Date("2024-03-01T00:00:00Z"));
    expect(range).toEqual({ from: "2024-02-01", to: "2024-03-01" });
    expect(reportRangeDays(range)).toHaveLength(30);
    expect(reportRangeDays(range)).toContain("2024-02-29");
  });
});
