import { describe, it, expect } from "vitest";

/**
 * The shared stat visuals behind Team Stats and Capacity.
 *
 * WHAT THEY REPLACED
 *
 * Team Stats rendered FOUR consecutive sections of the same bar rows — role,
 * department, team performance, productivity ranking. Four lists that look
 * identical read as one long list: the eye has nothing to catch on, and worse,
 * "how is the whole divided" and "who is ahead" are different questions being
 * drawn as if they were the same one.
 *
 *   ShareBar    a whole, divided — one segmented bar plus a legend.
 *   LeaderRow   a place in a ranking — the rank stated, not implied.
 *   LoadStrip   a distribution across load levels, for Capacity.
 *
 * WHAT IS ACTUALLY UNDER TEST
 *
 * These render, so the assertions measure emitted markup rather than source
 * text — the same harness tests/progressBarWidths.test.js uses, and for the
 * same reason: the defects here are about what reaches the screen. Each
 * component's real dependency is `cn`, so nothing needs stubbing.
 *
 * The rules being held:
 *   - a non-zero slice is never invisible, however small;
 *   - a zero-count category is dropped, not drawn as an empty row;
 *   - the number in the legend is the number the bar is drawn to;
 *   - categories use one neutral hue ramp, load levels use the STATUS tokens —
 *     the palette is what tells a reader which kind of number they are looking
 *     at, so the two must not converge;
 *   - every animated element carries a motion-reduce escape.
 */

const ReactNs = await import("react");
globalThis.React = ReactNs.default ?? ReactNs;
const { createElement: h } = globalThis.React;
const { renderToStaticMarkup } = await import("react-dom/server");

const { ShareBar, LeaderRow, LoadStrip } = await import("@/components/admin/statViz.jsx");

/** Widths of the segments in a strip. Reads up to `;` — segments also carry a min-width. */
const widths = (markup) => [...markup.matchAll(/style="width:([^";]+)/g)].map((m) => m[1]);

/** Renders a <li> component inside a list, so the markup is valid to inspect. */
const renderRow = (props) => renderToStaticMarkup(h("ul", null, h(LeaderRow, props)));

const ROLES = [
  { key: "developer", label: "Developer", count: 6 },
  { key: "qa", label: "QA", count: 3 },
  { key: "hr", label: "HR", count: 1 },
];

describe("ShareBar draws a whole, divided", () => {
  it("sizes each segment to its share of the total", () => {
    const markup = renderToStaticMarkup(h(ShareBar, { rows: ROLES, total: 10 }));
    expect(widths(markup)).toEqual(["60%", "30%", "10%"]);
  });

  it("prints the same percentage it drew", () => {
    const markup = renderToStaticMarkup(h(ShareBar, { rows: ROLES, total: 10 }));
    for (const pair of ["60%", "30%", "10%"]) expect(markup).toContain(pair);
    // And the raw counts, because a percentage alone loses "1 person" vs "1%".
    for (const role of ROLES) expect(markup).toContain(String(role.count));
  });

  it("gives the smallest slice a floor so it cannot vanish", () => {
    // One person in fifty is 2% — around 6px on a 300px container, and less
    // than a pixel once a border-radius clips it. "Nobody is in that role" and
    // "one person is" are different facts and must look different.
    const markup = renderToStaticMarkup(
      h(ShareBar, {
        rows: [
          { key: "dev", label: "Developer", count: 49 },
          { key: "hr", label: "HR", count: 1 },
        ],
        total: 50,
      })
    );
    expect(widths(markup)).toEqual(["98%", "2%"]);
    // A percentage floor would still round to nothing on a narrow container.
    expect(markup).toContain("min-width:0.375rem");
  });

  it("drops empty categories instead of drawing rows of zero", () => {
    const markup = renderToStaticMarkup(
      h(ShareBar, {
        rows: [
          { key: "dev", label: "Developer", count: 2 },
          { key: "devops", label: "DevOps", count: 0 },
        ],
        total: 2,
      })
    );
    expect(widths(markup)).toEqual(["100%"]);
    expect(markup).not.toContain("DevOps");
  });

  it("renders nothing at all rather than an empty track", () => {
    // The caller shows an EmptyState in this case; a bare grey bar underneath
    // it would read as "everybody is in a category with no name".
    expect(renderToStaticMarkup(h(ShareBar, { rows: [], total: 0 }))).toBe("");
    expect(renderToStaticMarkup(h(ShareBar, { rows: null, total: 0 }))).toBe("");
    expect(
      renderToStaticMarkup(h(ShareBar, { rows: [{ key: "a", label: "A", count: 0 }], total: 0 }))
    ).toBe("");
  });

  it("survives a total of zero without dividing by it", () => {
    // total=0 with non-zero rows is contradictory input; it must not produce
    // NaN% in a style attribute, which renders as no width at all.
    const markup = renderToStaticMarkup(
      h(ShareBar, { rows: [{ key: "a", label: "A", count: 3 }], total: 0 })
    );
    // Falls back to the sum of the rows it was given.
    expect(widths(markup)).toEqual(["100%"]);
    expect(markup).not.toContain("NaN");
  });

  it("walks ONE hue, not a rainbow", () => {
    // These are slices of a single quantity. Five hues would imply five
    // unrelated things — and would spend the status colours, which have to keep
    // meaning status (see LoadStrip below).
    const markup = renderToStaticMarkup(h(ShareBar, { rows: ROLES, total: 10 }));
    expect(markup).toMatch(/bg-primary\b/);
    expect(markup).toMatch(/bg-primary\/\d+/);
    for (const status of ["bg-success", "bg-warning", "bg-destructive", "bg-info"]) {
      expect(markup, `ShareBar must not use ${status}`).not.toContain(status);
    }
  });

  it("is announced as one image with the numbers in its label", () => {
    // Fifty <span>s with no text are noise to a screen reader. The strip is one
    // role="img" carrying the whole reading.
    const markup = renderToStaticMarkup(h(ShareBar, { rows: ROLES, total: 10 }));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Developer: 6, QA: 3, HR: 1"');
  });

  it("lets reduced motion out of the width transition", () => {
    const markup = renderToStaticMarkup(h(ShareBar, { rows: ROLES, total: 10 }));
    expect(markup).toContain("transition-[width]");
    expect(markup).toContain("motion-reduce:transition-none");
  });
});

describe("LeaderRow states the rank rather than implying it", () => {
  it("prints the rank as a number", () => {
    // Position is a lie the moment the list is filtered or re-sorted, and
    // "3rd of 40" is the fact somebody repeats out loud.
    const markup = renderRow({ rank: 3, label: "Ayesha", value: 82, unit: "score" });
    expect(markup).toContain(">3<");
    expect(markup).toContain("Ayesha");
    expect(markup).toContain("82");
    expect(markup).toContain("score");
  });

  it("weights the top three and not the rest", () => {
    const third = renderRow({ rank: 3, label: "C", value: 1 });
    const fourth = renderRow({ rank: 4, label: "D", value: 1 });
    expect(third).toContain("bg-primary text-primary-foreground");
    expect(fourth).not.toContain("bg-primary text-primary-foreground");
    expect(fourth).toContain("bg-muted text-muted-foreground");
  });

  it("omits the optional parts rather than drawing empty ones", () => {
    const bare = renderRow({ rank: 1, label: "Solo", value: 5 });
    expect(bare).not.toContain("rounded-full bg-gradient-to-br"); // no initials chip
    expect(widths(bare)).toEqual([]); // no share bar
    const full = renderRow({ rank: 1, label: "Solo", value: 5, initials: "SO", share: 40 });
    expect(full).toContain("SO");
    expect(widths(full)).toEqual(["40%"]);
  });

  it("clamps a share that arrives out of range", () => {
    // A score-derived share can exceed 100 when the denominator is an average
    // rather than a maximum. A 140%-wide fill escapes its track.
    expect(widths(renderRow({ rank: 1, label: "A", value: 1, share: 140 }))).toEqual(["100%"]);
    expect(widths(renderRow({ rank: 1, label: "A", value: 1, share: -20 }))).toEqual(["0%"]);
  });

  it("keeps a long name from pushing the number off the row", () => {
    const markup = renderRow({ rank: 1, label: "A".repeat(80), value: 5 });
    expect(markup).toContain("truncate");
    expect(markup).toContain("shrink-0");
    expect(markup).toContain('title="' + "A".repeat(80) + '"');
  });
});

describe("LoadStrip tints by meaning, because load is a state", () => {
  const LEVELS = [
    { id: "free", label: "Free", tone: "muted", count: 2 },
    { id: "steady", label: "Steady", tone: "success", count: 5 },
    { id: "heavy", label: "Heavy", tone: "warning", count: 2 },
    { id: "overloaded", label: "Overloaded", tone: "error", count: 1 },
  ];

  it("uses the status tokens, not the neutral ramp", () => {
    // This is the distinction that makes the two components readable side by
    // side: free/heavy/overloaded are STATES, and a reader who has learnt that
    // red means trouble must not meet red as "category four".
    const markup = renderToStaticMarkup(h(LoadStrip, { levels: LEVELS, total: 10 }));
    expect(markup).toContain("bg-success");
    expect(markup).toContain("bg-warning");
    expect(markup).toContain("bg-destructive");
    expect(markup).not.toMatch(/bg-primary\/\d+/);
  });

  it("sizes each band to its share of the people", () => {
    const markup = renderToStaticMarkup(h(LoadStrip, { levels: LEVELS, total: 10 }));
    expect(widths(markup)).toEqual(["20%", "50%", "20%", "10%"]);
  });

  it("drops levels nobody is in", () => {
    // A row of zeros is what makes the numbers that matter hard to find — the
    // same rule the Employees role tiles follow.
    const markup = renderToStaticMarkup(
      h(LoadStrip, {
        levels: [
          { id: "free", label: "Free", tone: "muted", count: 3 },
          { id: "overloaded", label: "Overloaded", tone: "error", count: 0 },
        ],
        total: 3,
      })
    );
    expect(markup).not.toContain("Overloaded");
    expect(widths(markup)).toEqual(["100%"]);
  });

  it("falls back to a visible fill for an unknown tone", () => {
    // An unmapped tone must not render a segment with no background class —
    // that is an invisible slice, which is the one failure this whole strip
    // exists to avoid.
    const markup = renderToStaticMarkup(
      h(LoadStrip, { levels: [{ id: "x", label: "X", tone: "chartreuse", count: 1 }], total: 1 })
    );
    expect(markup).toContain("bg-muted-foreground/40");
  });

  it("renders nothing when there is nobody to place", () => {
    expect(renderToStaticMarkup(h(LoadStrip, { levels: [], total: 0 }))).toBe("");
    expect(renderToStaticMarkup(h(LoadStrip, { levels: null, total: 0 }))).toBe("");
  });

  it("is announced as one image, like ShareBar", () => {
    const markup = renderToStaticMarkup(h(LoadStrip, { levels: LEVELS, total: 10 }));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Free: 2, Steady: 5, Heavy: 2, Overloaded: 1"');
  });
});

const { readFileSync } = await import("node:fs");
const nodePath = (await import("node:path")).default;
const root = nodePath.resolve(__dirname, "..");
const read = (rel) => readFileSync(nodePath.join(root, rel), "utf8");

/** Source with comments removed — a component NAMED in a comment is not a use of it. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the panels that consume them", () => {
  const STATS = stripComments(read("src/components/admin/TeamStats.jsx"));
  const CAPACITY = stripComments(read("src/components/admin/TeamCapacity.jsx"));

  it("Team Stats no longer stacks four identical bar lists", () => {
    // Both "share of the whole" panels use the strip; the ranking uses
    // LeaderRow. What is left as a bar list is team performance, which is the
    // one genuine magnitude comparison on the screen.
    expect(STATS).toMatch(/import \{ ShareBar, LeaderRow \} from "@\/components\/admin\/statViz"/);
    expect((STATS.match(/<ShareBar/g) || []).length).toBe(2);
    expect(STATS).toMatch(/<LeaderRow/);
  });

  it("feeds each strip its own rows against the headcount", () => {
    // Counting the panels is not enough — ShareBar renders NOTHING for an
    // empty `rows`, so a panel wired to the wrong variable (or to nothing)
    // disappears silently and still counts as present. Mutation-checked: this
    // is the assertion that fails when the department strip loses its data.
    expect(STATS).toMatch(/rows=\{roleRows\.map\(/);
    expect(STATS).toMatch(/rows=\{deptRows\.map\(/);
    // Both are a share of the same whole; scaling one to its own sum instead
    // would print two percentages that cannot be compared.
    expect((STATS.match(/total=\{headcount\}/g) || []).length).toBe(2);
  });

  it("has no orphaned BarRow left behind", () => {
    // It was exported, so nothing would have flagged it once its last caller
    // went. An exported component with no caller survives until somebody
    // copies it.
    expect(STATS).not.toMatch(/export function BarRow/);
    expect(STATS).not.toMatch(/<BarRow/);
  });

  it("Capacity leads with the strip, above the rows it summarises", () => {
    const strip = CAPACITY.indexOf("<LoadStrip");
    const caveat = CAPACITY.indexOf("Load is counted in open tasks");
    expect(strip).toBeGreaterThan(-1);
    expect(caveat).toBeGreaterThan(-1);
    // A summary printed after the forty rows it summarises is not a summary.
    expect(strip).toBeLessThan(caveat);
  });

  it("Capacity orders the levels free -> overloaded, not by count", () => {
    // The strip is read as a sentence about how much room there is, so the
    // bands must stay in rank order however the counts fall.
    expect(CAPACITY).toMatch(/sort\(\(a, b\) => a\.rank - b\.rank\)/);
  });
});
