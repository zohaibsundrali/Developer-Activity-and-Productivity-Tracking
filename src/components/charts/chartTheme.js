// Shared Apache ECharts theme — consistent with the app's "Refined Teal" design
// system. Canvas needs concrete hex values (not CSS vars), so tokens are mirrored
// here. Keep in sync with globals.css if the brand palette ever changes.

export const PRIMARY = "#0c8f6e"; // teal (≈ hsl(168 84% 30%))
export const PRIMARY_SOFT = "rgba(12, 143, 110, 0.14)";

// Categorical palette for multi-series charts.
export const PALETTE = [
  "#0c8f6e", // teal (brand)
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ef4444", // red
  "#14b8a6", // teal-2
  "#6366f1", // indigo
];

// Semantic accents (match tailwind tokens).
export const SEMANTIC = {
  success: "#16a34a",
  info: "#0ea5e9",
  warning: "#f59e0b",
  danger: "#ef4444",
  muted: "#94a3b8",
};

// Task/project status colors — preserved from the previous charts so status
// semantics stay identical across the app (Gantt bars, legends, badges).
export const GANTT_STATUS_COLORS = {
  completed: "#10b981",
  reviewed: "#0c8f6e",
  awaiting_approval: "#f59e0b",
  in_progress: "#3b82f6",
  pending: "#9ca3af",
  rejected: "#ef4444",
};

// Neutrals for axes / grid / text (light theme — the app runs light).
const INK = "#1e293b";
const MUTED = "#64748b";
const LINE = "#e2e8f0";

export const FONT_FAMILY =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const axisLabel = { color: MUTED, fontSize: 11, fontFamily: FONT_FAMILY };
export const axisLine = { lineStyle: { color: LINE } };
export const splitLine = { lineStyle: { color: LINE, type: "dashed" } };

export const baseGrid = { left: 8, right: 16, top: 28, bottom: 8, containLabel: true };

export const baseTooltip = {
  backgroundColor: "#ffffff",
  borderColor: LINE,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: INK, fontSize: 12, fontFamily: FONT_FAMILY },
  extraCssText:
    "box-shadow: 0 8px 30px rgba(30,41,59,0.12); border-radius: 10px;",
};

export const baseLegend = {
  top: 0,
  right: 0,
  icon: "roundRect",
  itemWidth: 10,
  itemHeight: 10,
  textStyle: { color: MUTED, fontSize: 11, fontFamily: FONT_FAMILY },
};

export const textStyle = { fontFamily: FONT_FAMILY, color: INK };

// A vertical linear gradient fill for area/bar charts (echarts graphic object).
export function verticalGradient(topHex, bottomAlpha = 0.02, topAlpha = 0.28) {
  const toRgba = (hex, a) => {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  return {
    type: "linear",
    x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color: toRgba(topHex, topAlpha) },
      { offset: 1, color: toRgba(topHex, bottomAlpha) },
    ],
  };
}

// Rounded-corner bar item style helper.
export const roundedBar = (color, radius = [6, 6, 0, 0]) => ({
  color,
  borderRadius: radius,
});
