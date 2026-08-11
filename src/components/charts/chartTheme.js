// Shared Apache ECharts theme.
//
// ECharts paints to a <canvas> and cannot read CSS custom properties, so the
// design tokens are mirrored here as literals. THIS IS THE ONLY FILE ALLOWED TO
// HOLD LITERAL COLOUR VALUES — components must use Tailwind token classes.
// Every literal below is the exact hex of a token in src/app/globals.css; the
// HSL it came from is written beside it so the two can be diffed by eye.
//
//   --primary          243 70% 56%   #4840dd
//   --success          142 71% 30%   #16833e
//   --warning           38 92% 48%   #eb980a
//   --destructive        0 72% 51%   #dc2828
//   --info             199 89% 48%   #0da2e7
//   --background       210 30% 98%   #f8fafb
//   --card               0  0% 100%  #ffffff
//   --foreground       200 25% 12%   #172126
//   --muted-foreground 210 12% 46%   #677583
//   --border           214 22% 90%   #e0e5eb
//   --radius                         0.75rem = 12px

/* ------------------------------------------------------------------ */
/*  Neutrals                                                           */
/* ------------------------------------------------------------------ */

const INK = "#172126"; // --foreground
const MUTED = "#677583"; // --muted-foreground
const LINE = "#e0e5eb"; // --border
const SURFACE = "#ffffff"; // --card

// Gridlines are --border at low opacity. They must be visible enough to read a
// value against and quiet enough that the data is what the eye lands on.
//
// Stepped down from 0.9 to 0.55: at full strength the grid was reading as a
// second layer of content competing with the series. A gridline only has to be
// findable when the eye is already looking for a value — it does not have to be
// legible from across the room.
const GRID = "rgba(224, 229, 235, 0.55)";

// An inert "everything else" fill: --border stepped one notch darker
// (214 20% 88%). Used for the remainder half of a progress bar and for the
// unstarted arc of a donut, where a saturated hue would claim attention it has
// not earned.
const TRACK = "#dae0e7";

/* ------------------------------------------------------------------ */
/*  Brand                                                              */
/* ------------------------------------------------------------------ */

export const PRIMARY = "#4840dd"; // --primary 243 70% 56%
export const PRIMARY_SOFT = "rgba(72, 64, 221, 0.10)";

/* ------------------------------------------------------------------ */
/*  Series palettes                                                    */
/* ------------------------------------------------------------------ */

/**
 * CATEGORICAL — for series whose order carries no meaning (two different
 * measures, "ideal vs actual", named apps that are not ranked).
 *
 * Six hues, brand indigo first, in a FIXED order that is assigned in sequence
 * and never cycled or re-sorted. The order is not a taste call: it is the
 * ordering that maximised the worst adjacent-pair separation under simulated
 * protanopia/deuteranopia out of every permutation of these hues
 * (worst adjacent ΔE 14.4 CVD / 20.4 normal vision, OKLab ×100).
 *
 * Deliberately SIX and not the old seven: the previous palette carried two
 * near-identical teals, and a chart that needs seven saturated hues at once is
 * the thing that makes a dashboard look amateur. Past six series, fold the tail
 * into "Other" or facet the chart — do not invent a seventh hue.
 */
export const PALETTE = [
  "#4840dd", // indigo  — --primary
  "#da2f68", // rose
  "#9854d4", // violet
  "#16833e", // green   — --success
  "#eb980a", // amber   — --warning
  "#1b99a7", // teal
];

/**
 * RANKED — for categories that ARE ordered: "top N apps by time", "largest
 * projects", any slice list sorted by size. One hue family (brand indigo)
 * stepped in lightness, strongest first, so the reader sees the ranking in the
 * colour instead of decoding six unrelated hues.
 *
 * Monotone in lightness with every adjacent step ≥ 0.06 apart in OKLCH L, and
 * the palest step still clears 2:1 against a white card.
 */
export const RANKED = [
  "#221e76",
  "#2a24ae",
  "#372fda",
  "#5d56e1",
  "#847fe6",
  "#aaa6ed",
];

/** Ranked colour for slot `i`, clamped (never wraps back to the dark end). */
export const rankedColor = (i) => RANKED[Math.min(i, RANKED.length - 1)];

/* ------------------------------------------------------------------ */
/*  Semantic accents                                                   */
/* ------------------------------------------------------------------ */

// Reserved meanings. A status colour never doubles as "series 4", and it always
// ships with a label or legend entry beside it — amber sits below 3:1 on white
// by design, so the text is what carries it, not the fill.
export const SEMANTIC = {
  success: "#16833e", // --success
  info: "#0da2e7", // --info
  warning: "#eb980a", // --warning
  danger: "#dc2828", // --destructive
  muted: MUTED, // --muted-foreground
  track: TRACK, // inert remainder
};

// Task/project status colours. Shared by the Gantt bars, the timeline view and
// the list chips so the three can never drift apart.
//   completed / reviewed  → success, stepped in lightness (both are "done")
//   in_progress           → brand indigo (active work)
//   awaiting_approval     → warning
//   rejected              → destructive
//   pending               → an inert neutral: not-yet-started is not a state
//                           that should compete for attention
export const GANTT_STATUS_COLORS = {
  completed: "#16833e", // --success            142 71% 30%
  reviewed: "#10602d", // --success, darker     142 71% 22%
  awaiting_approval: "#eb980a", // --warning     38 92% 48%
  in_progress: "#4840dd", // --primary          243 70% 56%
  pending: "#a6b2bf", // neutral                212 16% 70%
  rejected: "#dc2828", // --destructive           0 72% 51%
};

/* ------------------------------------------------------------------ */
/*  Type                                                               */
/* ------------------------------------------------------------------ */

export const FONT_FAMILY =
  "var(--font-inter), Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// One type scale for every axis in the app: 11px, muted, never bold. Axis text
// is a reference grid, not content — if it competes with the data it is wrong.
export const axisLabel = { color: MUTED, fontSize: 11, fontFamily: FONT_FAMILY };

// Axis titles sit one step down again so they never read as a series name.
export const axisName = { color: MUTED, fontSize: 11, fontFamily: FONT_FAMILY };

export const textStyle = { fontFamily: FONT_FAMILY, color: INK };

/* ------------------------------------------------------------------ */
/*  Axes & grid                                                        */
/* ------------------------------------------------------------------ */

// Solid, 1px, --border at low opacity. Dashed gridlines add a second visual
// rhythm that fights the data for no information gain.
export const splitLine = { lineStyle: { color: GRID, width: 1, type: "solid" } };

export const axisLine = { lineStyle: { color: LINE } };

/**
 * Value axis: gridlines but no axis line and no ticks — the gridlines already
 * say where the numbers are, so the rule and the tick marks are duplication.
 * `splitNumber: 4` is the point of the whole thing: four labelled steps is
 * enough to read a magnitude off, and it is roughly half what echarts picks by
 * default.
 */
export const valueAxis = {
  type: "value",
  // Three labelled steps, down from four. A reader takes a magnitude off a
  // chart by finding the two gridlines a point sits between; more lines than
  // that buys precision nobody is asking a dashboard for, and each one is
  // another horizontal rule crossing the data.
  splitNumber: 3,
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel,
  splitLine,
  nameTextStyle: axisName,
};

/**
 * Category axis: the baseline stays (it anchors the bars) but the gridlines go.
 * Vertical gridlines behind a bar chart almost never earn their place.
 */
export const categoryAxis = {
  type: "category",
  axisLine,
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel,
  nameTextStyle: axisName,
};

// `containLabel` lets echarts measure the real label box, so the tight left/
// right values below are padding around the labels rather than around the plot.
export const baseGrid = { left: 8, right: 16, top: 28, bottom: 8, containLabel: true };

/* ------------------------------------------------------------------ */
/*  Tooltip & legend                                                   */
/* ------------------------------------------------------------------ */

// Matches the app's card: white surface, --border hairline, --radius corners,
// the `shadow-popover` token. `confine` keeps it inside the canvas instead of
// hanging off the edge of a narrow panel.
export const baseTooltip = {
  backgroundColor: SURFACE,
  borderColor: LINE,
  borderWidth: 1,
  padding: [8, 12],
  confine: true,
  textStyle: { color: INK, fontSize: 12, fontFamily: FONT_FAMILY },
  extraCssText:
    "box-shadow: 0 8px 30px hsl(200 25% 12% / 0.12); border-radius: 12px; font-variant-numeric: tabular-nums;",
};

// Top-right, out of the plot. Charts that use it must open enough `grid.top`
// to clear it — see `gridWithLegend`.
export const baseLegend = {
  top: 0,
  right: 0,
  icon: "roundRect",
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 14,
  textStyle: { color: MUTED, fontSize: 11, fontFamily: FONT_FAMILY },
};

/**
 * A legend only earns its place when there is more than one series to tell
 * apart — with one series the panel heading already names it. Returns `{ show:
 * false }` below two series so callers can pass this unconditionally.
 */
export const legendFor = (seriesCount, extra = {}) =>
  seriesCount > 1 ? { ...baseLegend, ...extra } : { show: false };

/**
 * Grid top that clears a legend rather than letting it sit on the plot. Pass
 * the same series count used for `legendFor` so the two can never disagree.
 */
export const gridWithLegend = (seriesCount, grid = {}) => ({
  ...baseGrid,
  top: seriesCount > 1 ? 36 : 16,
  ...grid,
});

/* ------------------------------------------------------------------ */
/*  Number formatting                                                  */
/* ------------------------------------------------------------------ */

/** 30000 → "30,000". Thousands separators everywhere, always. */
export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

/** Axis-width integers: 30000 → "30k". Keeps a y-axis from eating the plot. */
export const fmtCompact = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return fmtInt(v);
};

/** 8.333 hours → "8h 20m". Never print a raw decimal hour at a reader. */
export const fmtHours = (h) => {
  const v = Number(h) || 0;
  if (v === 0) return "0h";
  const sign = v < 0 ? "-" : "";
  const total = Math.round(Math.abs(v) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${sign}${mm}m`;
  if (mm === 0) return `${sign}${fmtInt(hh)}h`;
  return `${sign}${fmtInt(hh)}h ${mm}m`;
};

/** 95.5 minutes → "1h 35m"; 0.4 minutes → "24s". */
export const fmtMinutes = (m) => {
  const v = Number(m) || 0;
  if (v === 0) return "0m";
  if (Math.abs(v) < 1) return `${Math.round(v * 60)}s`;
  return fmtHours(v / 60);
};

/**
 * Percentages carry no more precision than the data supports: whole numbers by
 * default, because a productivity score of "73.4%" implies a resolution the
 * underlying task counts do not have.
 */
export const fmtPct = (v, dp = 0) => `${(Number(v) || 0).toFixed(dp)}%`;

/* ------------------------------------------------------------------ */
/*  Mark helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * A soft vertical fill under a line. Kept subtle on purpose: the fill is there
 * to tie the line to the baseline, not to be a gradient.
 */
export function verticalGradient(topHex, bottomAlpha = 0.01, topAlpha = 0.16) {
  const toRgba = (hex, a) => {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: toRgba(topHex, topAlpha) },
      { offset: 1, color: toRgba(topHex, bottomAlpha) },
    ],
  };
}

/**
 * Bar fill: a flat colour and a 4px radius on the data end only. No border, no
 * shadow, no gradient — a bar chart is a set of rectangles and whitespace.
 */
export const roundedBar = (color, radius = [4, 4, 0, 0]) => ({ color, borderRadius: radius });

/** Same, for a horizontal bar growing to the right. */
export const roundedBarH = (color, radius = [0, 4, 4, 0]) => ({ color, borderRadius: radius });

/**
 * A 2px seam of card surface between stacked segments.
 *
 * Spread into the `itemStyle` of every segment in a stack. The eye resolves an
 * edge far faster than it resolves a change of hue, so the gap is what makes a
 * stacked bar readable — and it is what keeps the boundary visible for a reader
 * who cannot separate the two colours at all. Painting the border in the card
 * colour rather than drawing a line means the seam reads as space, not as ink.
 */
export const stackGap = { borderColor: SURFACE, borderWidth: 2 };

/**
 * The latest value, printed at the end of a line, as an echarts
 * `series.endLabel`.
 *
 * This is the direct-labelling half of "fewer legends". On a single-series line
 * the panel heading already says WHAT the line is; what the reader actually
 * wants is WHERE IT IS NOW, and that is one number at the right-hand end rather
 * than a legend swatch repeating a name they have already read.
 *
 * The number wears an ink token, not the series colour: a coloured mark beside
 * text carries identity, coloured text just makes the text harder to read.
 * Never combine this with a label on every point — the whole point is that one
 * value is worth printing and forty are not.
 *
 *   series: [{ type: "line", ...ENDLABEL_ANCHOR, endLabel: endLabel(fmtInt) }]
 */
export const endLabel = (format = fmtInt) => ({
  show: true,
  formatter: (p) => format(p.value),
  color: INK,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: FONT_FAMILY,
  offset: [4, 0],
});

/**
 * Right-hand padding that leaves room for `endLabel` to sit outside the plot
 * instead of on top of the last data point. Spread over a grid.
 */
export const gridWithEndLabel = (grid = {}) => ({ ...baseGrid, right: 44, ...grid });

/**
 * The centre label for a donut, as an echarts `series.label`.
 *
 * A donut with an empty middle wastes the one spot on the chart the eye goes to
 * first, so the headline number lives there. Built here rather than in each
 * dashboard so the ink/muted values stay inside this file — components must not
 * carry literal colours.
 *
 *   label: donutCenter(totalMinutes, fmtMinutes, "tracked")
 *
 * Pair it with `emphasis: { scale: false, label: { show: true } }` so the number
 * is a fixed readout rather than something that appears on hover.
 */
export const donutCenter = (value, format = fmtInt, caption = "") => ({
  show: true,
  position: "center",
  formatter: () => `{v|${format(value)}}\n{l|${caption}}`,
  rich: {
    v: { fontSize: 22, fontWeight: 600, color: INK, fontFamily: FONT_FAMILY },
    l: { fontSize: 11, color: MUTED, fontFamily: FONT_FAMILY, padding: [4, 0, 0, 0] },
  },
});

/** Standard emphasis for a donut carrying a fixed centre readout. */
export const donutCenterEmphasis = { scale: false, label: { show: true } };

/**
 * Row-count-driven chart height. A fixed height turns 40 categories into
 * slivers and a single category into a stripe floating in whitespace; both read
 * as broken. `perRow` is the band each category gets, `chrome` is the axis and
 * legend furniture above and below the plot.
 */
export const heightForRows = (rows, { perRow = 34, chrome = 72, min = 220, max = 900 } = {}) =>
  Math.min(max, Math.max(min, (Number(rows) || 0) * perRow + chrome));
