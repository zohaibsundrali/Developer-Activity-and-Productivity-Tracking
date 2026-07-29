"use client";

import { useMemo, useState } from "react";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

// Subtle status tone → chip classes (mirrors KanbanView's TONE_STYLES).
const TONE_STYLES = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card overflow-x-auto">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-foreground">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold tabular-nums">
            {MONTHS[cursor.m]} {cursor.y}
          </h3>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous month"
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next month"
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="min-w-[720px]">
        {/* Weekday header */}
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className="px-1.5 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {wd}
            </div>
          ))}
        </div>

        {/* Weeks */}
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
                  className="min-h-[96px] border border-border p-1.5 align-top"
                >
                  <div className="mb-1 flex justify-end">
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums ${
                        isToday
                          ? "bg-primary/10 font-semibold text-primary"
                          : cell.inMonth
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                      }`}
                    >
                      {cell.d}
                    </span>
                  </div>

                  <div className="space-y-1">
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
                          className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${
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
    </div>
  );
}
