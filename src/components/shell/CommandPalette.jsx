"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  AlertTriangle,
  RotateCw,
  Clock,
  X,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  SearchX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/utils/authFetch";
import { getOrgContext } from "@/utils/orgContext";
import { TONE_CLASSES } from "./notificationVisuals";
import {
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  navCommandsFor,
  isNavCommandAllowed,
  filterNavCommands,
  buildResultGroups,
  metaChips,
  withFlatIndexes,
  loadRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
} from "./searchCommands";

/**
 * Global command palette (Cmd/Ctrl + K).
 *
 * One input, two modes: with no usable query it is a launcher for the sections
 * the signed-in role may actually open; past the minimum query length it is a
 * search over /api/search, grouped by record type.
 *
 * Mounted by AppShell so it exists exactly once per dashboard — the Cmd+K
 * listener is global, and two of them would toggle each other back closed.
 */
export default function CommandPalette({ open = false, onOpenChange }) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [orgCtx, setOrgCtx] = useState(null);
  const [recents, setRecents] = useState([]);
  const [results, setResults] = useState(null);
  const [totals, setTotals] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const rowRefs = useRef(new Map());
  const abortRef = useRef(null);

  const term = query.trim();
  const isSearchMode = term.length >= MIN_QUERY_LENGTH;

  /* ---------------------------------------------------------------- *
   * Cmd/Ctrl + K and Escape.
   * ---------------------------------------------------------------- */

  // The handler is attached once on mount and torn down on unmount. It reads
  // `open` and the callback through refs so that binding never has to be
  // re-registered — re-attaching a window listener on every open/close is how
  // duplicate-listener bugs get in.
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key === "k" && (event.metaKey || event.ctrlKey)) {
        // Browsers bind Cmd+K to the address bar / a site search box.
        event.preventDefault();
        onOpenChangeRef.current?.(!openRef.current);
        return;
      }
      if (event.key === "Escape" && openRef.current) {
        onOpenChangeRef.current?.(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* ---------------------------------------------------------------- *
   * Open / close side effects.
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open) return undefined;

    // Re-read on every open rather than once on mount: the session can change
    // under a long-lived shell, and a stale role would show forbidden sections.
    setOrgCtx(getOrgContext());
    setRecents(loadRecentSearches());
    setActiveIndex(0);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    // Closing discards the query so the next Cmd+K starts from the launcher
    // rather than someone else's half-typed search.
    if (open) return;
    setQuery("");
    setResults(null);
    setTotals(null);
    setTruncated(false);
    setError(null);
    setLoading(false);
  }, [open]);

  /* ---------------------------------------------------------------- *
   * Debounced, abortable search.
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open) return undefined;

    if (term.length < MIN_QUERY_LENGTH) {
      // Below the threshold the contract returns nothing and runs no queries,
      // so there is no reason to spend a request finding that out.
      setResults(null);
      setTotals(null);
      setTruncated(false);
      setError(null);
      setLoading(false);
      return undefined;
    }

    // The spinner goes up immediately even though the request is 250ms away —
    // the user has already typed, and a silent gap reads as a broken input.
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({ q: term, limit: String(SEARCH_LIMIT) });

      authFetch(`/api/search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (controller.signal.aborted) return;

          if (!response.ok || !body?.success) {
            setError(body?.error || "Search failed. Please try again.");
            setResults(null);
            setTotals(null);
            setTruncated(false);
            return;
          }

          setResults(body.results && typeof body.results === "object" ? body.results : {});
          setTotals(body.totals && typeof body.totals === "object" ? body.totals : {});
          setTruncated(Boolean(body.truncated));
          setError(null);
        })
        .catch((err) => {
          // An aborted request was superseded on purpose — its failure is not
          // news, and reporting it would flash an error over live results.
          if (err?.name === "AbortError" || controller.signal.aborted) return;
          setError("Search is unavailable right now.");
          setResults(null);
          setTotals(null);
          setTruncated(false);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      // A newer keystroke supersedes whatever is in flight. Without this, a slow
      // answer for "pro" can land after the quick answer for "project" and
      // overwrite the newer, correct results.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open, term, retryToken]);

  // Nothing should still be talking to the network once the palette unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------------------------------------------------------------- *
   * Derived lists.
   * ---------------------------------------------------------------- */

  const navCommands = useMemo(() => navCommandsFor(orgCtx), [orgCtx]);

  const { groups, flat } = useMemo(() => {
    if (isSearchMode) {
      return withFlatIndexes(buildResultGroups(results, totals));
    }

    const built = [];
    const commands = filterNavCommands(navCommands, term);
    if (commands.length > 0) {
      built.push({ key: "commands", label: "Go to", count: null, rows: commands });
    }
    if (term.length === 0 && recents.length > 0) {
      built.push({
        key: "recents",
        label: "Recent searches",
        count: null,
        rows: recents.map((entry) => ({
          key: `recent:${entry}`,
          kind: "recent",
          title: entry,
          subtitle: null,
          meta: null,
          href: null,
          icon: Clock,
          tone: "muted",
        })),
      });
    }
    return withFlatIndexes(built);
  }, [isSearchMode, results, totals, navCommands, term, recents]);

  // A changed list invalidates the cursor — keep it in range without letting a
  // hover-set highlight get stomped while the list is stable.
  useEffect(() => {
    setActiveIndex(0);
  }, [flat]);

  const safeIndex = activeIndex < flat.length ? activeIndex : 0;

  // Keyboard movement must not leave the highlight below the fold.
  useEffect(() => {
    if (!open) return;
    const node = rowRefs.current.get(safeIndex);
    node?.scrollIntoView({ block: "nearest" });
  }, [safeIndex, open]);

  /* ---------------------------------------------------------------- *
   * Activation.
   * ---------------------------------------------------------------- */

  const close = useCallback(() => onOpenChange?.(false), [onOpenChange]);

  const activate = useCallback(
    (row) => {
      if (!row || row.disabled) return;

      if (row.kind === "recent") {
        // Re-running a past term, not navigating — put it back in the input and
        // let the normal debounce path fetch it.
        setQuery(row.title);
        inputRef.current?.focus();
        return;
      }

      if (row.kind === "command" && !isNavCommandAllowed(row, orgCtx)) return;

      if (row.kind === "result") setRecents(saveRecentSearch(term));
      if (!row.href) return;

      close();
      router.push(row.href);
    },
    [close, orgCtx, router, term]
  );

  const handleInputKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flat.length === 0) return;
      setActiveIndex((index) => (index + 1) % flat.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(flat[safeIndex]);
    }
  };

  const handleClearRecents = () => setRecents(clearRecentSearches());

  if (!open) return null;

  const showKeepTyping = term.length > 0 && term.length < MIN_QUERY_LENGTH;
  const showEmpty = isSearchMode && !loading && !error && groups.length === 0;
  const showNoCommands = !isSearchMode && !showKeepTyping && groups.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center sm:p-6 sm:pt-[10vh]">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className={cn(
          "relative flex h-full w-full flex-col overflow-hidden bg-card",
          "sm:h-auto sm:max-h-[70vh] sm:max-w-2xl sm:rounded-xl sm:border sm:border-border sm:shadow-elevated",
          "animate-fade-in"
        )}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search projects, tasks, people…"
            aria-label="Search projects, tasks, people"
            autoComplete="off"
            spellCheck="false"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain p-2">
          {showKeepTyping && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Keep typing — {MIN_QUERY_LENGTH} characters minimum to search.
            </p>
          )}

          {error && (
            <div className="m-2 flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-6 text-center">
              <AlertTriangle className="h-6 w-6 text-warning" />
              <p className="text-sm text-foreground">{error}</p>
              <button
                type="button"
                onClick={() => setRetryToken((token) => token + 1)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <RotateCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          )}

          {loading && !error && groups.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          )}

          {showEmpty && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <SearchX className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No results for “{term}”</p>
              <p className="text-xs text-muted-foreground">
                Try a shorter term, or check the spelling.
              </p>
            </div>
          )}

          {showNoCommands && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching commands.
            </p>
          )}

          {truncated && isSearchMode && !error && groups.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
              Showing partial results — narrow the search to see everything.
            </p>
          )}

          {groups.map((group) => (
            <section key={group.key} className="mb-1">
              <div className="flex items-center justify-between px-3 pb-1 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.key === "recents" ? (
                  <button
                    type="button"
                    onClick={handleClearRecents}
                    className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : (
                  group.count && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {group.count}
                    </span>
                  )
                )}
              </div>

              <ul>
                {group.rows.map((row) => (
                  <li key={row.key}>
                    <PaletteRow
                      row={row}
                      active={!row.disabled && row.flatIndex === safeIndex}
                      onActivate={activate}
                      onHover={setActiveIndex}
                      registerRef={(node) => {
                        if (row.disabled) return;
                        if (node) rowRefs.current.set(row.flatIndex, node);
                        else rowRefs.current.delete(row.flatIndex);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer legend */}
        <div className="hidden items-center gap-4 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground sm:flex">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="h-3 w-3" />
            <ArrowDown className="h-3 w-3" />
            Navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" />
            Open
          </span>
          <span className="ml-auto">Esc to close</span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({ row, active, onActivate, onHover, registerRef }) {
  const Icon = row.icon;
  const chips = metaChips(row.meta);

  const body = (
    <>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          TONE_CLASSES[row.tone] || TONE_CLASSES.muted
        )}
      >
        {Icon && <Icon className="h-4 w-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
        {/* `subtitle` is nullable by contract — an absent one collapses the line. */}
        {row.subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{row.subtitle}</span>
        )}
        {chips.length > 0 && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {chip.value}
              </span>
            ))}
          </span>
        )}
      </span>
    </>
  );

  // A hit with href === null is not navigable. It stays visible because it is a
  // real match, but it gets no button, no hover state and no pointer — nothing
  // that would promise a destination the contract says does not exist.
  if (row.disabled) {
    return (
      <div
        aria-disabled="true"
        className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left opacity-60"
      >
        {body}
        <span className="shrink-0 self-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          No link
        </span>
      </div>
    );
  }

  return (
    <button
      ref={registerRef}
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={() => onActivate(row)}
      // onMouseMove, not onMouseEnter: arrowing down scrolls the list under a
      // stationary cursor, and an enter event fired by that scroll would yank
      // the highlight back. Only a real pointer movement takes it over.
      onMouseMove={() => onHover(row.flatIndex)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60"
      )}
    >
      {body}
      {active && (
        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
      )}
    </button>
  );
}
