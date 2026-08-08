"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, BellOff } from "lucide-react";
import {
  CATEGORY_KEYS,
  categoryMeta,
  fetchNotificationPreferences,
  setNotificationPreference,
} from "@/utils/notifications";
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
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            <BellOff className="h-3.5 w-3.5" />
            {mutedCount} muted
          </p>
        )}
      </div>

      {loading && !preferences ? (
        <div className="flex flex-col items-center justify-center px-4 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Loading preferences…</p>
        </div>
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
              <button
                type="button"
                onClick={load}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1
                  text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry</span>
              </button>
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
                <li key={item.key} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${item.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{enabled ? "On" : "Muted"}</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${item.label} notifications`}
                    disabled={busy}
                    onClick={() => toggle(item.key, !enabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border
                      transition-colors disabled:cursor-wait disabled:opacity-60 ${
                        enabled ? "border-primary bg-primary" : "border-border bg-muted"
                      }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-card shadow-card transition-transform ${
                        enabled ? "translate-x-6" : "translate-x-1"
                      }`}
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
