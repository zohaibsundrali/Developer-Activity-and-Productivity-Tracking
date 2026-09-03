"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Gauge, TriangleAlert } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Section,
  Skeleton,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";

/**
 * The measured half of Capacity.
 *
 * WHAT THIS ANSWERS THAT THE PANEL BELOW IT CANNOT. `orgWorkGraph.js` says it
 * plainly: the load labels are a convention, not a measurement, because nothing
 * recorded how long a task takes. Four things did exist and had never been
 * joined — estimated hours (016), project allocation (071, never populated),
 * approved leave (075) and logged time (017). Migration 088 joins them.
 *
 * It sits ABOVE the task-count view rather than replacing it, deliberately. The
 * counts still work on the day the hours are unset, which is most organizations
 * on day one; and a screen that went blank the moment a better number was
 * available would be a downgrade dressed as an upgrade.
 *
 * NULL IS RENDERED AS "not set", NEVER AS A NUMBER. `available_hours` and
 * `utilisation_pct` come back null when nobody has said how many hours a person
 * works. Filling that in with 40 would plan every part-timer, contractor and
 * intern as full-time — the table would look complete and nobody would go
 * looking. The row says what is missing and who can fix it.
 */

/** The ISO Monday of whatever week contains `d`. */
function isoMonday(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; // Sunday -> 7
  x.setUTCDate(x.getUTCDate() - (day - 1));
  return x.toISOString().slice(0, 10);
}

const shiftWeek = (monday, n) =>
  new Date(Date.parse(`${monday}T00:00:00Z`) + n * 7 * 86400000).toISOString().slice(0, 10);

const num = (v, suffix = "") =>
  v === null || v === undefined ? null : `${Number(v)}${suffix}`;

export default function CapacityPlan({ people = [] }) {
  const [week, setWeek] = useState(() => isoMonday());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const nameOf = useCallback(
    (id) => {
      const p = people.find((x) => String(x.id) === String(id));
      return p?.name || p?.full_name || p?.email || "Someone";
    },
    [people]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/capacity?week=${encodeURIComponent(week)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load the plan.");
      setRows(json.rows || []);
    } catch (e) {
      setError(e?.message || "Could not load the plan.");
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    let known = 0;
    let unknown = 0;
    let over = 0;
    for (const r of rows) {
      if (r.weekly_hours == null) unknown += 1;
      else known += 1;
      if (Number(r.allocation_pct) > 100) over += 1;
    }
    return { known, unknown, over };
  }, [rows]);

  const thisWeek = isoMonday();

  return (
    <Section
      title="Planned capacity"
      description="Contracted hours, minus approved leave, against what was actually logged."
      actions={
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setWeek(shiftWeek(week, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Previous week</span>
          </Button>
          <span className="px-2 text-sm font-medium tabular-nums">{week}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeek(shiftWeek(week, 1))}
            disabled={week >= thisWeek}
            title={week >= thisWeek ? "That week has not happened yet" : "Next week"}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Next week</span>
          </Button>
          {week !== thisWeek && (
            <Button variant="ghost" size="sm" onClick={() => setWeek(thisWeek)}>
              This week
            </Button>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load the plan" description={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Nothing recorded for that week"
          description="A person appears here once they have logged time or have approved leave in the week."
        />
      ) : (
        <>
          {/* Said once, at the top, rather than repeated down every row. */}
          {summary.unknown > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {summary.unknown} of {rows.length} {rows.length === 1 ? "person has" : "people have"} no
                contracted hours set, so nothing can be planned for them. Someone with HR access sets
                that on the employee record — it is deliberately left blank rather than assumed to be
                a full week.
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Person</th>
                  <th className="py-2 pr-4 font-medium">Contracted</th>
                  <th className="py-2 pr-4 font-medium">Leave</th>
                  <th className="py-2 pr-4 font-medium">Available</th>
                  <th className="py-2 pr-4 font-medium">Logged</th>
                  <th className="py-2 pr-4 font-medium">Used</th>
                  <th className="py-2 pr-4 font-medium">Allocated</th>
                  <th className="py-2 pr-4 font-medium">Backlog</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const unset = r.weekly_hours == null;
                  const over = Number(r.allocation_pct) > 100;
                  const util = r.utilisation_pct;
                  return (
                    <tr key={`${r.user_id}-${r.week_start}`} className="border-b border-border/60">
                      <td className="py-2 pr-4 text-foreground">{nameOf(r.user_id)}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {unset ? (
                          <span className="text-xs text-muted-foreground">not set</span>
                        ) : (
                          num(r.weekly_hours, "h")
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {Number(r.leave_days) > 0 ? `${r.leave_days}d` : "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {/* NULL, never a guess. See the note at the top. */}
                        {r.available_hours == null ? "—" : num(r.available_hours, "h")}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{num(r.logged_hours, "h")}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {util == null ? (
                          "—"
                        ) : (
                          <span className={Number(util) > 100 ? "text-destructive" : ""}>{util}%</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {r.allocation_pct == null ? (
                          <span className="text-xs text-muted-foreground">
                            {r.project_count > 0 ? `${r.project_count} projects, unset` : "—"}
                          </span>
                        ) : (
                          <span className={over ? "text-destructive" : ""}>
                            {r.allocation_pct}%
                            {over && (
                              <Badge variant="destructive" className="ml-2">over</Badge>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {r.open_estimated_hours == null ? "—" : num(r.open_estimated_hours, "h")}
                        {/* An estimate that covers half the open tasks is worth
                            less than one that covers all of them, and the reader
                            cannot tell which unless told. */}
                        {r.unestimated_open_tasks > 0 && (
                          <span className="ml-1 text-xs">+{r.unestimated_open_tasks} unestimated</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            Available is contracted hours less approved leave. Allocated is the share of a person
            committed across running projects and may exceed 100% — that is a real state, shown
            rather than refused.
          </p>
        </>
      )}
    </Section>
  );
}
