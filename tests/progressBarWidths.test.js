import { describe, it, expect, vi } from "vitest";

/**
 * Two progress bars that contradicted the label printed on the same row.
 *
 *  1. Team stats → "Distribution by role". The row printed each role's share of
 *     headcount ("Owner 1 (50%)") while the bar was scaled to the LARGEST
 *     bucket. In a two-person org with one Owner and one Developer both buckets
 *     are the largest, so both bars rendered `width: 100%` — 548 of 548px —
 *     beside a label reading 50%.
 *
 *  2. Billing → "Usage this period". An unlimited limit is -1, and the bar took
 *     that branch by drawing 100%: four resources on an Unlimited plan rendered
 *     as full primary meters ("at the wall") directly under a stat card reading
 *     "Resources at limit: 0".
 *
 * Both helpers live in client components, so those modules' UI-only
 * dependencies are stubbed — the functions under test are pure.
 */

// Every icon either file imports, stubbed to nothing. (A catch-all Proxy would
// make the module namespace thenable, and `await import()` on a thenable
// namespace never settles — the run hangs rather than failing, so keep the
// list explicit even though it needs updating when an import changes.)
const ICON_NAMES = [
  "Activity",
  "AlertTriangle",
  "Ban",
  "BarChart3",
  "Building2",
  "Check",
  "CheckCircle2",
  "Clock",
  "CreditCard",
  "ExternalLink",
  "FlaskConical",
  "Gauge",
  "Info",
  "Loader2",
  "Receipt",
  "RefreshCw",
  "TrendingUp",
  "Users",
  "X",
];
vi.mock("lucide-react", () =>
  Object.fromEntries(ICON_NAMES.map((name) => [name, () => null]))
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => null,
}));
vi.mock("@/components/shell/StatCard", () => ({ default: () => null }));
vi.mock("@/components/ui", () => ({
  Badge: () => null,
  Button: () => null,
  DataTable: () => null,
  EmptyState: () => null,
  ErrorState: () => null,
  PageHeader: () => null,
  Section: () => null,
  Skeleton: () => null,
  StatusPill: () => null,
}));
vi.mock("@/utils/supabaseClient", () => ({ supabase: {} }));
vi.mock("@/utils/orgContext", () => ({ getOrgId: () => "org" }));
vi.mock("@/utils/employeesData", () => ({ loadEmployees: async () => ({}) }));
vi.mock("@/utils/authFetch", () => ({ authFetch: async () => ({}) }));
vi.mock("@/utils/alerts", () => ({ showConfirm: async () => false, showError: () => {} }));

// Next injects the automatic JSX runtime; vitest's esbuild compiles these files
// with the classic one, which expects a global `React`. Neither component
// imports the default export, so supply it here rather than reshaping the app's
// build config for the sake of a test.
const ReactNs = await import("react");
globalThis.React = ReactNs.default ?? ReactNs;
const { createElement: h } = globalThis.React;
const { renderToStaticMarkup } = await import("react-dom/server");
const { pct, distributionRows, BarRow } = await import("@/components/admin/TeamStats.jsx");
const { usageMetric, usageBarWidth, UsageBar } = await import(
  "@/components/admin/BillingSubscription.jsx"
);

// The audit measured the rendered `style.width` of each fill, so these assert
// on exactly that: the markup the component emits, not just the arithmetic.
const fillWidths = (element) =>
  [...renderToStaticMarkup(element).matchAll(/style="width:([^"]+)"/g)].map((m) => m[1]);

describe("team stats distribution bars are drawn to the share they print", () => {
  it("draws a normal percentage at that percentage", () => {
    const rows = distributionRows(new Map([["owner", 3], ["developer", 1]]), 4);
    expect(rows.map((r) => [r.key, r.share])).toEqual([
      ["owner", 75],
      ["developer", 25],
    ]);
  });

  it("does not fill a tied bucket to the full track", () => {
    // The measured defect: 1 Owner + 1 Developer in a 2-person org.
    const rows = distributionRows(new Map([["owner", 1], ["developer", 1]]), 2);
    expect(rows.every((r) => r.share === 50)).toBe(true);
    expect(rows.some((r) => r.share === 100)).toBe(false);
  });

  it("only reaches 100% when one bucket really is the whole population", () => {
    const rows = distributionRows(new Map([["unassigned", 2]]), 2);
    expect(rows[0].share).toBe(100);
  });

  it("never claims more of the population than exists", () => {
    const rows = distributionRows(new Map([["a", 5], ["b", 3], ["c", 2]]), 10);
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeLessThanOrEqual(100);
    expect(rows.every((r) => r.share >= 0 && r.share <= 100)).toBe(true);
  });

  it("ranks the biggest bucket first", () => {
    const rows = distributionRows(new Map([["a", 1], ["b", 7], ["c", 2]]), 10);
    expect(rows.map((r) => r.key)).toEqual(["b", "c", "a"]);
  });

  it("does not divide by zero when the population is empty", () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(0, 0)).toBe(0);
    const rows = distributionRows(new Map([["owner", 1]]), 0);
    expect(rows[0].share).toBe(0);
    expect(Number.isFinite(rows[0].share)).toBe(true);
  });

  it("accepts an empty distribution without inventing a row", () => {
    expect(distributionRows(new Map(), 0)).toEqual([]);
  });
});

describe("billing usage bars", () => {
  it("draws a bounded resource at its real percentage", () => {
    const row = usageMetric("employees", { used: 8, limit: 10, remaining: 2 });
    expect(row.pct).toBe(80);
    expect(usageBarWidth(row)).toBe(80);
  });

  it("fills the bar only when the limit is actually reached", () => {
    const row = usageMetric("projects", { used: 12, limit: 10, exceeded: true });
    expect(usageBarWidth(row)).toBe(100);
    const halfway = usageMetric("projects", { used: 5, limit: 10 });
    expect(usageBarWidth(halfway)).toBe(50);
  });

  it("renders no meter at all for an unlimited (-1) limit", () => {
    const row = usageMetric("active_tasks", { used: 9, limit: -1 });
    expect(row.unlimited).toBe(true);
    // The defect: this branch used to return 100, painting a full primary bar
    // on a plan with no ceiling.
    expect(usageBarWidth(row)).toBeNull();
    expect(usageBarWidth(row)).not.toBe(100);
  });

  it("treats every spelling of 'no ceiling' the same way", () => {
    for (const raw of [
      { used: 2, limit: -1 },
      { used: 2, unlimited: true, limit: -1 },
      { used: 2, limit: null },
      { used: 2 },
    ]) {
      const row = usageMetric("employees", raw);
      expect(row.unlimited).toBe(true);
      expect(usageBarWidth(row)).toBeNull();
    }
  });

  it("never marks an unlimited resource as near or at its limit", () => {
    const row = usageMetric("employees", { used: 100000, limit: -1 });
    expect(row.near).toBe(false);
    expect(row.pct).toBe(0);
  });

  it("does not divide by zero when the limit is zero", () => {
    const row = usageMetric("developers", { used: 3, limit: 0, exceeded: true });
    expect(row.unlimited).toBe(false);
    expect(Number.isFinite(row.pct)).toBe(true);
    expect(row.pct).toBe(0);
    // A zero ceiling is a real wall, so the bar still says "over limit".
    expect(usageBarWidth(row)).toBe(100);
  });

  it("does not divide by zero when nothing has been used yet", () => {
    const row = usageMetric("projects", { used: 0, limit: 0 });
    expect(Number.isFinite(usageBarWidth(row))).toBe(true);
    expect(usageBarWidth(row)).toBe(0);
  });

  it("warns before the wall, not only at it", () => {
    expect(usageMetric("employees", { used: 79, limit: 100 }).near).toBe(false);
    expect(usageMetric("employees", { used: 80, limit: 100 }).near).toBe(true);
  });
});

describe("what the rendered markup actually emits", () => {
  it("draws a role bar at the width printed beside it", () => {
    // Live org: Owner 1 and Developer 1 of a headcount of 2, both of which
    // rendered `width: 100%` (548 of 548px) beside a "(50%)" label.
    const rows = distributionRows(new Map([["owner", 1], ["developer", 1]]), 2);
    for (const row of rows) {
      expect(fillWidths(h(BarRow, { label: row.key, value: row.count, share: row.share }))).toEqual([
        "50%",
      ]);
    }
  });

  it("draws a majority role bar at its own share", () => {
    expect(fillWidths(h(BarRow, { label: "Owner", value: 3, share: 75 }))).toEqual(["75%"]);
    expect(fillWidths(h(BarRow, { label: "Unassigned", value: 2, share: 100 }))).toEqual(["100%"]);
  });

  it("emits no fill at all for an unlimited usage row", () => {
    // Live org: Employees 2, Developers 1, Projects 1, Active tasks 9 — every
    // one against an Unlimited plan, every one rendered `width: 100%`.
    for (const [key, used] of [
      ["employees", 2],
      ["developers", 1],
      ["projects", 1],
      ["active_tasks", 9],
    ]) {
      const row = usageMetric(key, { used, limit: -1 });
      const markup = renderToStaticMarkup(h(UsageBar, { row }));
      expect(fillWidths(h(UsageBar, { row }))).toEqual([]);
      expect(markup).not.toContain("progressbar");
      expect(markup).toContain("Unlimited");
      expect(markup).toContain("No limit on this plan");
    }
  });

  it("still draws a real meter for a bounded usage row", () => {
    const row = usageMetric("employees", { used: 8, limit: 10, remaining: 2 });
    const markup = renderToStaticMarkup(h(UsageBar, { row }));
    // 80% fill plus the fixed 80% warning tick.
    expect(fillWidths(h(UsageBar, { row }))).toEqual(["80%"]);
    expect(markup).toContain("progressbar");
    expect(markup).toContain('aria-valuenow="80"');
  });
});
