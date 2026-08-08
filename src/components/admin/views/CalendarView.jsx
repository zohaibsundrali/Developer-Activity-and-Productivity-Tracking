"use client";

import { useMemo, useState } from "react";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";
import { Button } from "@/components/ui";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { ViewEmpty, ViewPanel, ViewToolbar } from "@/components/admin/views/viewKit";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

// Status tone -> chip classes. Same tone vocabulary as every other view.
const TONE_STYLES = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
};

const WEEKDAYS = [
  { short: "S", full: "Sun" },
  { short: "M", full: "Mon" },
  { short: "T", full: "Tue" },
  { short: "W", full: "Wed" },
  { short: "T", full: "Thu" },
  { short: "F", full: "Fri" },
  { short: "S", full: "Sat" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Parse a YYYY-MM-DD string into {y,m,d} numbers, guarding NaN. Returns null on
// anything unparseable so callers can safely skip.
function parseYMD(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m: m - 1, d };
}

// Stable YYYY-MM-DD key for a (year, monthIndex, day) triple.
function dayKey(y, m, d) {
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/* -------------------------------------------------------------------------- */
/*  Calendar view                                                              */
/* -------------------------------------------------------------------------- */

export default function CalendarView({ tasks, onOpenTask }) {
  // Lazy init — never call new Date() at module scope.
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Today reference (recomputed per render — cheap, and correct across midnight).
  const today = (() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  })();

  // Group tasks by their placement date (due_date, fallback end_date).
  const tasksByDay = useMemo(() => {
    const map = {};
    for (const t of tasks || []) {
      if (!t) continue;
      const parsed = parseYMD(t.due_date) || parseYMD(t.end_date);
      if (!parsed) continue;
      const key = dayKey(parsed.y, parsed.m, parsed.d);
      (map[key] || (map[key] = [])).push(t);
    }
    return map;
  }, [tasks]);

  const placedCount = useMemo(
    () => Object.values(tasksByDay).reduce((acc, list) => acc + list.length, 0),
    [tasksByDay]
  );

  // Build the full weeks (leading/trailing days included) for the current month.
  const weeks = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startOffset = first.getDay(); // 0 = Sun
    const gridStart = new Date(cursor.y, cursor.m, 1 - startOffset);

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      cells.push({
        y: d.getFullYear(),
        m: d.getMonth(),
        d: d.getDate(),
        inMonth: d.getMonth() === cursor.m && d.getFullYear() === cursor.y,
      });
    }

    // Trim to whole weeks that actually touch the month (5 or 6 rows).
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    while (rows.length > 5 && !rows[rows.length - 1].some((c) => c.inMonth)) rows.pop();
    return rows;
  }, [cursor]);

  const goPrev = () =>
    setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const goNext = () =>
    setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  const goToday = () => {
    const d = new Date();
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const toolbar = (
    <ViewToolbar
      icon={CalendarDays}
      title={`${MONTHS[cursor.m]} ${cursor.y}`}
      description={`${placedCount} dated task${placedCount === 1 ? "" : "s"}`}
    >
      <Button variant="outline" size="icon-sm" onClick={goPrev} aria-label="Previous month">
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button variant="outline" size="sm" onClick={goToday}>
        Today
      </Button>
      <Button variant="outline" size="icon-sm" onClick={goNext} aria-label="Next month">
        <ChevronRight aria-hidden="true" />
      </Button>
    </ViewToolbar>
  );

  if (!tasks || tasks.length === 0) {
    return (
      <div className="space-y-4">
        {toolbar}
        <ViewEmpty icon={CalendarDays} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}

      <ViewPanel className="p-2 sm:p-4">
        {/* Weekday header */}
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((wd, i) => (
            <div
              key={i}
              className="px-1 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <span className="sm:hidden" aria-hidden="true">{wd.short}</span>
              <span className="hidden sm:inline">{wd.full}</span>
              <span className="sr-only">{wd.full}</span>
            </div>
          ))}
        </div>

        {/* Weeks */}
        <div className="overflow-hidden rounded-lg border border-border">
          {weeks.map((row, ri) => (
            <div key={ri} className="grid grid-cols-7">
              {row.map((cell) => {
                const key = dayKey(cell.y, cell.m, cell.d);
                const dayTasks = tasksByDay[key] || [];
                const isToday =
                  cell.y === today.y && cell.m === today.m && cell.d === today.d;

                return (
                  <div
                    key={key}
                    className={`min-h-[72px] border-b border-r border-border p-1 last:border-r-0 sm:min-h-[112px] sm:p-1.5 ${
                      cell.inMonth ? "" : "bg-muted/20"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-1">
                      {/* Mobile: a single count stands in for the chips, which are
                          unreadable in a 50px-wide cell. */}
                      {dayTasks.length > 0 ? (
                        <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary sm:hidden">
                          {dayTasks.length}
                        </span>
                      ) : (
                        <span className="sm:hidden" />
                      )}
                      <span
                        className={`ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums ${
                          isToday
                            ? "bg-primary font-semibold text-primary-foreground"
                            : cell.inMonth
                            ? "text-foreground"
                            : "text-muted-foreground/60"
                        }`}
                      >
                        {cell.d}
                      </span>
                    </div>

                    <div className="hidden space-y-1 sm:block">
                      {dayTasks.slice(0, 3).map((task) => {
                        const meta =
                          STATUS_META[normalizeStatus(task.status)] || { tone: "muted" };
                        return (
                          <button
                            type="button"
                            key={task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenTask && onOpenTask(task);
                            }}
                            title={task.task_title || "Untitled task"}
                            className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              TONE_STYLES[meta.tone] || TONE_STYLES.muted
                            }`}
                          >
                            {task.task_title || "Untitled task"}
                          </button>
                        );
                      })}

                      {dayTasks.length > 3 && (
                        <div className="px-1.5 text-[10px] text-muted-foreground">
                          +{dayTasks.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {placedCount === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            None of the matching tasks have a due date, so nothing is placed on this calendar.
          </p>
        ) : null}
      </ViewPanel>
    </div>
  );
}
