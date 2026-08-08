"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, BellOff } from "lucide-react";
import {
  CATEGORY_KEYS,
  categoryMeta,
  fetchNotificationPreferences,
  setNotificationPreference,
} from "@/utils/notifications";
import { Badge, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { categoryIcon, toneClass } from "./notificationVisuals";

/**
 * Which categories the signed-in user still wants to hear about.
 *
 * The switches only RECORD the choice. Muting is enforced by a BEFORE INSERT
 * trigger on `notifications`, because seven writers insert rows and only one of
 * them goes through `notify()` — a filter in the UI, or in any single writer,
 * would be a filter the other six walk past. Nothing here has to exclude muted
 * rows from a list: a muted notification is never written in the first place.
 *
 * Which also sets what a user can expect: switching a category off stops the
 * next one, and leaves everything already sent exactly where it is.
 *
 * The identity these rows are written under is never on screen and never a
 * prop — see `setNotificationPreference`, which reads it from the session.
 */
export default function NotificationPreferences() {
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Per-category, so one slow write disables one switch rather than the panel.
  const [pending, setPending] = useState({});
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { preferences: loaded, error: loadError } = await fetchNotificationPreferences();
    setPreferences(loaded);
    setError(loadError || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (category, nextEnabled) => {
      setSaveError(null);
      setPending((prev) => ({ ...prev, [category]: true }));
      // Optimistic: a switch that waits on a round trip before moving reads as
      // broken, and gets pressed again.
      setPreferences((prev) => ({ ...prev, [category]: nextEnabled }));

      const { error: writeError } = await setNotificationPreference(category, nextEnabled);

      setPending((prev) => {
        const next = { ...prev };
        delete next[category];
        return next;
      });

      if (writeError) {
        // Back to where it was. A switch left showing the state the user asked
        // for, over a row that was never written, is a promise of silence that
        // the database has not agreed to keep.
        setPreferences((prev) => ({ ...prev, [category]: !nextEnabled }));
        setSaveError(writeError);
      }
    },
    []
  );

  const items = useMemo(
    () =>
      CATEGORY_KEYS.map((key) => {
        const meta = categoryMeta(key);
        return {
          key,
          label: meta.label,
          Icon: categoryIcon(meta),
          tone: toneClass(meta),
        };
      }),
    []
  );

  const mutedCount = useMemo(
    () => (preferences ? CATEGORY_KEYS.filter((key) => preferences[key] === false).length : 0),
    [preferences]
  );

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">Notification preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Turn a category off and nothing new in it is sent to you. Anything already here stays.
        </p>
        {mutedCount > 0 && (
          <Badge variant="secondary" size="md" className="mt-2">
            <BellOff aria-hidden="true" />
            {mutedCount} muted
          </Badge>
        )}
      </div>

      {loading && !preferences ? (
        // One placeholder per real switch row — the panel keeps its height, so
        // the column next to it does not reflow when the read lands.
        <ul className="divide-y divide-border" aria-busy="true">
          {CATEGORY_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-10" />
              </div>
              <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* A read that failed still renders the switches, in the state a user
              with no saved rows is actually in — but says so, because otherwise
              every category reads as "on" whether it is or not. */}
          {error && (
            <div className="flex items-start gap-2 border-b border-border bg-destructive/5 px-4 py-3 sm:px-5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Couldn&apos;t load your saved preferences</p>
                <p className="text-xs text-muted-foreground">
                  {error.message || "Showing defaults."} Your saved choices are still in effect.
                </p>
              </div>
              <Button variant="outline" size="xs" onClick={load} className="shrink-0">
                <RefreshCw aria-hidden="true" />
                <span>Retry</span>
              </Button>
            </div>
          )}

          {saveError && (
            <div className="border-b border-border bg-destructive/5 px-4 py-3 text-xs text-muted-foreground sm:px-5">
              <span className="font-medium text-foreground">That change didn&apos;t save. </span>
              {saveError.message || "Please try again."}
            </div>
          )}

          <ul className="divide-y divide-border">
            {items.map((item) => {
              const enabled = preferences?.[item.key] !== false;
              const busy = Boolean(pending[item.key]);
              const { Icon } = item;

              return (
                <li key={item.key} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/40 motion-reduce:transition-none sm:px-5">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", item.tone)}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                    {/* State in words as well as in the switch position, so
                        "muted" survives a screenshot and a screen reader. */}
                    <p className="text-xs text-muted-foreground">{enabled ? "On" : "Muted"}</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${item.label} notifications`}
                    disabled={busy}
                    onClick={() => toggle(item.key, !enabled)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      "disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none",
                      enabled ? "border-primary bg-primary" : "border-border bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 rounded-full bg-card shadow-card transition-transform duration-150 motion-reduce:transition-none",
                        enabled ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
