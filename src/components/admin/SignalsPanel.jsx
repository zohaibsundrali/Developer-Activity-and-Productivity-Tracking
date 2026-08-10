"use client";

import { useCallback, useEffect, useState } from "react";

import { AlertTriangle, CheckCircle2, Info, RefreshCw, Siren } from "lucide-react";

import { cn } from "@/lib/utils";
import { authFetch } from "@/utils/authFetch";
import { Button } from "@/components/ui";

/**
 * Signals — the panel that says what needs attention, rather than what happened.
 *
 * Every other panel on this dashboard reports a number. This one reads the
 * numbers and forms an opinion, so the design job is different: nothing here is
 * a chart, and the empty state is the GOOD state. Most days it should say
 * "nothing to flag" and be believed.
 *
 * ORDER IS THE INFORMATION. The API returns worst first and this renders in
 * that order without re-sorting — a panel that groups by kind, or by person,
 * buries the one critical line under nine routine ones.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *  No dismiss button. A signal is not a task: it clears when the underlying
 *  condition clears, and a "mark as read" would let somebody silence a sprint
 *  that is still going to miss. The nightly job in /api/cron is what pushes
 *  the important ones into the notification centre, where dismissing is
 *  meaningful because it means "I have seen this", not "this is no longer true".
 */

const SEVERITY = {
  critical: {
    Icon: Siren,
    ring: "border-destructive/35 bg-destructive/[0.06]",
    tone: "text-destructive",
    label: "Needs attention now",
  },
  warning: {
    Icon: AlertTriangle,
    ring: "border-warning/35 bg-warning/[0.07]",
    tone: "text-warning-on-tint",
    label: "Worth a look",
  },
  info: {
    Icon: Info,
    ring: "border-border bg-muted/40",
    tone: "text-muted-foreground",
    label: "For information",
  },
};

export default function SignalsPanel({ className }) {
  const [state, setState] = useState({ loading: true, signals: [], counts: {}, degraded: false });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try {
      const res = await authFetch("/api/signals");
      if (res.status === 403) {
        // Not a role that sees this. Render nothing at all rather than an
        // empty panel that implies the workspace is quiet.
        setState({ loading: false, signals: [], counts: {}, hidden: true });
        return;
      }
      // ANY other non-2xx is "we do not know", not "all clear".
      //
      // `authFetch` does not throw on a bad status — it returns the Response —
      // so a 401 used to fall straight through to `res.json()`, produce
      // `{error:"Unauthorized"}`, leave `signals` empty and `degraded` false,
      // and render the reassuring green "nothing to flag". `getAuthedOrg`
      // answers 401 both for an expired token and for the claim-drift condition
      // that database/052 exists to repair, so this is a live path.
      if (!res.ok) {
        setState({ loading: false, signals: [], counts: {}, degraded: true });
        return;
      }
      const data = await res.json();
      setState({
        loading: false,
        signals: Array.isArray(data.signals) ? data.signals : [],
        counts: data.counts || {},
        degraded: Boolean(data.degraded),
        generatedAt: data.generatedAt || null,
      });
    } catch {
      setState({ loading: false, signals: [], counts: {}, degraded: true });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.hidden) return null;

  const { signals, counts } = state;
  const total = signals.length;

  return (
    <section
      className={cn("rounded-xl border border-border bg-card p-5 shadow-card sm:p-6", className)}
      aria-labelledby="signals-heading"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="signals-heading" className="text-lg font-semibold text-foreground">
            Needs your attention
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {state.loading
              ? "Checking…"
              : total === 0
              ? "Nothing to flag today."
              : [
                  counts.critical ? `${counts.critical} urgent` : null,
                  counts.warning ? `${counts.warning} to look at` : null,
                  counts.info ? `${counts.info} for information` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => load({ quiet: true })}
          disabled={state.loading}
          className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", state.loading && "animate-spin motion-reduce:animate-none")}
            aria-hidden="true"
          />
          <span className="sr-only sm:not-sr-only">Refresh</span>
        </Button>
      </div>

      {state.degraded && (
        <p className="mb-3 text-sm text-muted-foreground">
          Couldn&apos;t check just now — this panel is showing nothing rather than guessing.
        </p>
      )}

      {!state.loading && total === 0 && !state.degraded && (
        // The empty state is the good state, and it is worth making that feel
        // deliberate rather than like a panel that failed to load.
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-6">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            No drops in tracked time, no reviews waiting, nothing overdue piling up and no sprint at
            risk. Checked against the last {"4 weeks"} of activity.
          </p>
        </div>
      )}

      {total > 0 && (
        <ul className="space-y-2.5">
          {signals.map((s) => {
            const meta = SEVERITY[s.severity] || SEVERITY.info;
            const { Icon } = meta;
            return (
              <li
                key={`${s.kind}:${s.subject?.id}`}
                className={cn("flex items-start gap-3 rounded-lg border p-3.5", meta.ring)}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.message}</p>
                </div>
                <span className="sr-only">{meta.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
