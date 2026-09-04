"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, RefreshCw, Undo2 } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Section,
  Skeleton,
} from "@/components/ui";
import { getOrgId } from "@/utils/orgContext";
import {
  loadEmployees,
  saveEmployee,
  reportingCycleError,
  reportingChain,
} from "@/utils/employeesData";
import { allowed } from "@/utils/permissions";
import { showError, showSuccess } from "@/utils/alerts";

/**
 * Reporting lines — who reports to whom.
 *
 * WHY THIS SCREEN EXISTS. `memberships.reports_to` has been in the schema since
 * 018 and load-bearing since 037: /api/signals reads it to decide whose work a
 * manager may see, the nightly digest in api/cron addresses a person's manager
 * through it, and ProjectHierarchy refuses to draw a reporting line without it
 * — its comment says, in as many words, that the column is null for every
 * member of this organization and that drawing one anyway would invent a
 * structure and then be believed.
 *
 * The only way to fill it in was the per-person profile editor: open somebody,
 * scroll to the field, save, close, repeat. For forty people that is forty
 * round trips through a modal, which is why nobody had done it. This is the
 * same column, edited as the list it actually is.
 *
 * IT INVENTS NOTHING. Every line is empty until a person here picks a manager.
 * There is no inferred default from team, from role rank, or from who created
 * whose account — a guess about who somebody answers to would be wrong quietly,
 * and every one of the three readers above would then be confidently wrong too.
 *
 * THE SAME WRITE PATH AS THE PROFILE EDITOR. `saveEmployee` is what both use,
 * so the cycle check, the notification and the RLS-checked update are one
 * implementation rather than two that drift. A second write path to the same
 * column is exactly the shape this codebase keeps having to repair.
 *
 * THREE GATES, NOT ONE. The Team Structure section is gated on `hierarchy.view`
 * and this panel is hidden without `hierarchy.manage`, but hiding is not
 * security: the write is a plain PostgREST update, so `memberships_update` in
 * 018 — as rewritten by 094 to honour a per-person override — is what actually
 * decides it, and 037's trigger refuses a loop whoever is asking.
 */

/** A cycle is refused before the write, so the message can use names. */

export default function ReportingLines() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  const mayManage = allowed("hierarchy.manage");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const orgId = getOrgId();
      const { employees: rows } = await loadEmployees(orgId);
      setEmployees(rows || []);
    } catch (e) {
      setError(e?.message || "Could not load the directory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Sorted by name so the list reads like a directory rather than like the
  // order rows happened to come back in.
  const people = useMemo(
    () => [...employees].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [employees]
  );

  const withManager = people.filter((p) => p.reportsTo).length;

  const setManager = async (emp, reportsTo) => {
    const next = reportsTo || null;
    if (String(emp.reportsTo || "") === String(next || "")) return;

    // Checked here so the refusal reads as a sentence with names in it. 037
    // repeats it in the database, which is where it actually counts.
    if (next) {
      const message = reportingCycleError({ employees, userId: emp.userId, reportsTo: next });
      if (message) {
        showError(message);
        return;
      }
    }

    setSavingId(emp.userId);
    try {
      const { error: err } = await saveEmployee({
        orgId: getOrgId(),
        emp,
        membershipPatch: { reports_to: next },
        employees,
      });
      if (err) throw new Error(err.message || "Could not save that.");
      setEmployees((prev) =>
        prev.map((p) => (p.userId === emp.userId ? { ...p, reportsTo: next } : p))
      );
      showSuccess(next ? "Reporting line saved." : "Reporting line cleared.");
    } catch (e) {
      showError(e?.message || "Could not save that.");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Reporting lines unavailable" description={error} onRetry={load} />;
  }

  return (
    <Section
      title="Reporting lines"
      description={
        mayManage
          ? "Who each person answers to. Nothing is filled in by default — a guess here would be believed by the signals feed and the nightly digest."
          : "Who each person answers to."
      }
      actions={
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      }
    >
      {people.length === 0 ? (
        <EmptyState
          icon={Network}
          title="Nobody in the directory yet"
          description="Add people on the Employees screen and their reporting lines appear here."
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            <span className="tabular-nums text-foreground">{withManager}</span> of{" "}
            <span className="tabular-nums text-foreground">{people.length}</span> have a manager
            set.
          </p>

          <ul className="space-y-2">
            {people.map((p) => {
              const chain = reportingChain(people, p.userId);
              const busy = savingId === p.userId;
              return (
                <li
                  key={p.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.email}
                      {p.role ? ` · ${p.role.replace(/_/g, " ")}` : ""}
                    </p>
                    {chain.length > 1 && (
                      // The chain is worth showing because it is the thing a
                      // single dropdown cannot: two legal choices can produce a
                      // ladder nobody meant.
                      <p className="mt-1 text-xs text-muted-foreground">
                        {chain.map((c) => c.name).join(" → ")}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {mayManage ? (
                      <>
                        <label className="sr-only" htmlFor={`manager-${p.userId}`}>
                          Manager for {p.name}
                        </label>
                        <select
                          id={`manager-${p.userId}`}
                          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={p.reportsTo || ""}
                          disabled={busy}
                          onChange={(e) => setManager(p, e.target.value)}
                        >
                          <option value="">No manager</option>
                          {people
                            // Somebody cannot report to themselves; 037 refuses
                            // it and there is no reason to offer it.
                            .filter((o) => o.userId !== p.userId)
                            .map((o) => (
                              <option key={o.userId} value={o.userId}>
                                {o.name}
                              </option>
                            ))}
                        </select>
                        {p.reportsTo && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setManager(p, null)}
                            aria-label={`Clear the manager for ${p.name}`}
                          >
                            <Undo2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <Badge variant={p.reportsTo ? "secondary" : "outline"}>
                        {p.reportsTo
                          ? people.find((o) => o.userId === p.reportsTo)?.name || "Set"
                          : "Not set"}
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Section>
  );
}
