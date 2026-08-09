"use client";

/**
 * HeroVisual — the product visual that fills the right column of the hero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A PLACEHOLDER FOR A REAL SCREENSHOT.
 *
 * It is a purpose-built, hand-drawn abstraction of the product's own shell —
 * browser chrome, the dark sidebar the app actually uses, a header row, three
 * stat tiles, a bar chart and two task rows. It is drawn in HTML/CSS with this
 * project's design tokens so it themes with the rest of the site.
 *
 * Nothing here was downloaded, traced or adapted from anyone else's marketing
 * site or from a stock library. That is deliberate: the owner is launching
 * commercially, and a competitor's hero image is a real legal exposure.
 *
 * It also deliberately contains **no text, no numbers and no data**. Every
 * label, metric and task title is a neutral shape. A mockup that shows "94%
 * productivity" or "12 developers online" is a claim the product has not made,
 * and a hero is the worst possible place to make one by accident. Icons carry
 * the domain (board, timer, screenshots, people, reports); shapes carry the
 * layout; nothing carries a figure.
 *
 * TO REPLACE THIS WITH A REAL SCREENSHOT: swap the body of this one component
 * for an `<Image>` (or a `<picture>`), keep the `aria-hidden` root and the
 * `h-full w-full` sizing contract, and delete the rest. Hero.jsx owns the
 * frame, the ground panel and the reserved aspect-ratio box, so no other file
 * has to change and no layout shift is introduced.
 *
 * Sizing contract with Hero.jsx:
 *   - The parent reserves the box (fixed aspect ratio). This component fills it
 *     with `h-full w-full` and never sets its own height.
 *   - The frame is `overflow-hidden`, so at small sizes the mockup crops rather
 *     than spilling or forcing the parent to grow.
 *
 * Motion: none. There is nothing to animate, nothing to load, and nothing that
 * can move once it has painted. The entrance fade belongs to the `Reveal` in
 * Hero.jsx, which is already reduced-motion safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  BarChart3,
  Camera,
  ClipboardCheck,
  LayoutDashboard,
  LayoutGrid,
  Timer,
  Users,
} from "lucide-react";

/** The sidebar silhouette. One row is "current", as it is in the real shell. */
const SIDEBAR_ROWS = [
  { key: "overview", icon: LayoutDashboard, width: "w-3/5", active: false },
  { key: "board", icon: LayoutGrid, width: "w-4/5", active: true },
  { key: "reviews", icon: ClipboardCheck, width: "w-2/3", active: false },
  { key: "activity", icon: Timer, width: "w-1/2", active: false },
  { key: "people", icon: Users, width: "w-3/5", active: false },
  { key: "reports", icon: BarChart3, width: "w-2/5", active: false },
];

/** Three stat tiles. Icon + label shape + value shape — no figures. */
const STAT_TILES = [
  { key: "tracked", icon: Timer, label: "w-3/5", value: "w-1/2" },
  { key: "shots", icon: Camera, label: "w-2/3", value: "w-2/5" },
  { key: "done", icon: ClipboardCheck, label: "w-1/2", value: "w-3/5" },
];

/**
 * Bar heights for the chart. Arbitrary percentages of the plot area, chosen to
 * read as a plausible shape and nothing more — there is no axis, no scale and
 * no number, so there is nothing here to misread as a measurement.
 */
const CHART_BARS = [
  "h-[38%]",
  "h-[56%]",
  "h-[44%]",
  "h-[72%]",
  "h-[60%]",
  "h-[85%]",
  "h-[50%]",
];

/** Two task rows, mirroring the board's row density. */
const TASK_ROWS = [
  { key: "one", dot: "bg-success", title: "w-1/2", chip: "w-10" },
  { key: "two", dot: "bg-warning", title: "w-2/3", chip: "w-8" },
];

export default function HeroVisual({ className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={[
        "flex h-full w-full select-none flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Browser chrome. Three dots and an empty address pill — no URL, because
          a URL in a mockup is either wrong or a claim about a live product. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted px-2.5 py-2 sm:gap-2 sm:px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-border sm:h-2 sm:w-2" />
        <span className="h-1.5 w-1.5 rounded-full bg-border sm:h-2 sm:w-2" />
        <span className="h-1.5 w-1.5 rounded-full bg-border sm:h-2 sm:w-2" />
        <span className="ml-1.5 h-3 w-1/2 max-w-[14rem] rounded-full border border-border bg-background sm:ml-2 sm:h-4" />
      </div>

      {/* Body: sidebar + workspace. `min-h-0` lets the workspace shrink inside
          the reserved box instead of pushing the frame taller. */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar silhouette — the app's real shell is a dark rail. */}
        <div className="flex w-[26%] max-w-[8.5rem] shrink-0 flex-col gap-1.5 bg-sidebar p-2 sm:gap-2 sm:p-2.5">
          {/* Brand mark */}
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[4px] bg-primary sm:h-3 sm:w-3" />
            <span className="h-1.5 w-2/3 rounded-full bg-sidebar-muted/40" />
          </div>

          {SIDEBAR_ROWS.map(({ key, icon: Icon, width, active }) => (
            <div
              key={key}
              className={[
                "flex items-center gap-1.5 rounded-md px-1 py-1",
                active ? "bg-sidebar-primary/20" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Icon
                className={[
                  "h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3",
                  active ? "text-sidebar-primary" : "text-sidebar-muted",
                ].join(" ")}
                strokeWidth={2}
              />
              <span
                className={[
                  "h-1.5 rounded-full",
                  width,
                  active ? "bg-sidebar-primary/50" : "bg-sidebar-muted/40",
                ].join(" ")}
              />
            </div>
          ))}

          {/* The account chip the real rail pins to its foot. `mt-auto` keeps
              the rail from reading as a half-empty block at tall aspect
              ratios. */}
          <div className="mt-auto flex items-center gap-1.5 border-t border-sidebar-border pt-2">
            <span className="h-3 w-3 shrink-0 rounded-full bg-sidebar-primary sm:h-3.5 sm:w-3.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="h-1.5 w-4/5 rounded-full bg-sidebar-muted/40" />
              <span className="h-1 w-1/2 rounded-full bg-sidebar-muted/25" />
            </span>
          </div>
        </div>

        {/* Workspace */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 bg-background p-2 sm:gap-2.5 sm:p-3">
          {/* Header row: page title shape on the left, two people on the right. */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="h-2 w-1/4 rounded-full bg-foreground/70 sm:h-2.5" />
            <span className="h-1.5 w-1/6 rounded-full bg-muted-foreground/25" />
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <span className="h-3.5 w-3.5 rounded-full border border-border bg-muted sm:h-4 sm:w-4" />
              <span className="h-3.5 w-3.5 rounded-full border border-border bg-accent sm:h-4 sm:w-4" />
            </span>
          </div>

          {/* Stat tiles */}
          <div className="grid shrink-0 grid-cols-3 gap-1.5 sm:gap-2">
            {STAT_TILES.map(({ key, icon: Icon, label, value }) => (
              <div
                key={key}
                className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-1.5 shadow-card sm:gap-2 sm:p-2"
              >
                <div className="flex items-center gap-1">
                  <Icon className="h-2.5 w-2.5 shrink-0 text-primary sm:h-3 sm:w-3" strokeWidth={2} />
                  <span className={["h-1 rounded-full bg-muted-foreground/25", label].join(" ")} />
                </div>
                <span className={["h-2 rounded-full bg-foreground/70 sm:h-2.5", value].join(" ")} />
              </div>
            ))}
          </div>

          {/* Chart card. `flex-1` + `min-h-0` means the chart absorbs whatever
              height is left over, so the frame stays exactly as tall as the
              reserved box at every width. */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-md border border-border bg-card p-1.5 shadow-card sm:gap-2 sm:p-2">
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="h-1.5 w-1/3 rounded-full bg-muted-foreground/25" />
              <span className="ml-auto h-1.5 w-6 rounded-full bg-accent" />
            </div>
            <div className="flex min-h-0 flex-1 items-end gap-1 border-b border-border pb-0.5 sm:gap-1.5">
              {CHART_BARS.map((height, index) => (
                <span
                  key={height + String(index)}
                  className={[
                    "flex-1 rounded-t-[3px]",
                    height,
                    index === CHART_BARS.length - 2 ? "bg-primary" : "bg-primary/30",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>

          {/* Task rows */}
          <div className="flex shrink-0 flex-col gap-1.5 sm:gap-2">
            {TASK_ROWS.map(({ key, dot, title, chip }) => (
              <div
                key={key}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-1.5 shadow-card sm:gap-2 sm:px-2"
              >
                <span className={["h-1.5 w-1.5 shrink-0 rounded-full sm:h-2 sm:w-2", dot].join(" ")} />
                <span className={["h-1.5 rounded-full bg-muted-foreground/25", title].join(" ")} />
                <span className={["ml-auto h-2 shrink-0 rounded-full bg-accent sm:h-2.5", chip].join(" ")} />
                <span className="h-3 w-3 shrink-0 rounded-full border border-border bg-muted sm:h-3.5 sm:w-3.5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
