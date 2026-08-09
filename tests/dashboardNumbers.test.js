import { describe, it, expect, vi } from "vitest";

/**
 * Two numbers the dashboards used to state as fact while the data said
 * otherwise.
 *
 *  1. `productivity_sessions.total_duration` is SECONDS. Sampled production rows
 *     equal `end_time - start_time` in seconds exactly, and some carry
 *     fractional values (e.g. 359.57) that minutes could not produce. The
 *     session card was the only reader labelling it "min", so a 19-minute
 *     session rendered as "1141 min" — nineteen hours.
 *
 *  2. The timesheet productivity score is `(on-time − late) ÷ total × 100 + 50`.
 *     The +50 baseline pushes a flawless developer to 150, and only the lower
 *     bound was clamped, so the card showed a percentage above 100.
 *
 * Both helpers live in client components, so the modules' UI-only dependencies
 * are stubbed — the functions under test are pure and touch none of them.
 */

vi.mock("@/components/charts/EChart", () => ({ default: () => null }));
vi.mock("@/components/charts/chartTheme", () => ({
  PALETTE: [],
  SEMANTIC: {},
  textStyle: {},
  baseGrid: {},
  baseTooltip: {},
  baseLegend: {},
  axisLabel: {},
  axisLine: {},
  splitLine: {},
}));
vi.mock("@/components/ui", () => ({
  Badge: () => null,
  EmptyState: () => null,
  ErrorState: () => null,
  Skeleton: () => null,
  SkeletonTable: () => null,
  StatusPill: () => null,
  Tabs: () => null,
}));
vi.mock("@/utils/supabaseClient", () => ({ supabase: {} }));

const { formatSessionDuration } = await import("@/components/developer/SessionUI.jsx");
const { productivityPercent } = await import("@/components/developer/Timesheet.jsx");

describe("session duration is read as seconds", () => {
  it("renders a real session at its true length, not as minutes", () => {
    // Production row: start 10:38:34, end 10:57:36, total_duration 1141.
    // Read as minutes this was "1141 min" (19 hours) for 19 minutes of work.
    expect(formatSessionDuration(1141)).toBe("00:19:01");
  });

  it("agrees with the other readers' seconds-based formatting", () => {
    expect(formatSessionDuration(28800)).toBe("08:00:00"); // a full working day
    expect(formatSessionDuration(480)).toBe("00:08:00"); // eight minutes, not eight hours
    expect(formatSessionDuration(3600)).toBe("01:00:00");
    expect(formatSessionDuration(59)).toBe("00:00:59");
  });

  it("floors the fractional values the tracker writes for periodic rows", () => {
    // e.g. total_duration 359.57 on a `periodic` session.
    expect(formatSessionDuration(359.57)).toBe("00:05:59");
  });

  it("shows a zero rather than a blank or a negative for missing values", () => {
    expect(formatSessionDuration(0)).toBe("00:00:00");
    expect(formatSessionDuration(null)).toBe("00:00:00");
    expect(formatSessionDuration(undefined)).toBe("00:00:00");
    expect(formatSessionDuration("not a number")).toBe("00:00:00");
    expect(formatSessionDuration(-90)).toBe("00:00:00");
  });

  it("does not convert twice — the value is already seconds", () => {
    // Guard against a "helpful" ×60 creeping back in: 1141 must never become
    // 19 hours, which is what treating the column as minutes produces.
    expect(formatSessionDuration(1141)).not.toBe("19:01:00");
  });
});

describe("timesheet productivity score stays a real percentage", () => {
  it("never exceeds 100 when every completed task was on time", () => {
    // 10 of 10 on time: (10 − 0)/10 × 100 + 50 = 150 before clamping.
    expect(productivityPercent(10, 0, 10)).toBe(100);
    expect(productivityPercent(1, 0, 1)).toBe(100);
  });

  it("never drops below 0 when every completed task was late", () => {
    // 0 on time, 10 late: (0 − 10)/10 × 100 + 50 = −50 before clamping.
    expect(productivityPercent(0, 10, 10)).toBe(0);
  });

  it("leaves in-range scores exactly as the stated formula computes them", () => {
    expect(productivityPercent(0, 0, 4)).toBe(50); // nothing completed yet
    expect(productivityPercent(2, 2, 4)).toBe(50); // half on time, half late
    expect(productivityPercent(3, 1, 4)).toBe(100); // (2/4)×100 + 50 = 100, at the cap
    expect(productivityPercent(2, 1, 4)).toBe(75); // (1/4)×100 + 50 = 75
    expect(productivityPercent(1, 2, 4)).toBe(25); // (−1/4)×100 + 50 = 25
  });

  it("reports 0 rather than dividing by zero when there are no tasks", () => {
    expect(productivityPercent(0, 0, 0)).toBe(0);
  });

  it("returns whole numbers inside the range for every mix of outcomes", () => {
    for (let total = 1; total <= 12; total += 1) {
      for (let onTime = 0; onTime <= total; onTime += 1) {
        for (let late = 0; late <= total - onTime; late += 1) {
          const pct = productivityPercent(onTime, late, total);
          expect(Number.isInteger(pct)).toBe(true);
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
