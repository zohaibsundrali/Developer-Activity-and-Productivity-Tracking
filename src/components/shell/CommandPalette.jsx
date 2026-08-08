"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  RotateCw,
  Clock,
  X,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  SearchX,
  Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/utils/authFetch";
import { getOrgContext } from "@/utils/orgContext";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useDialog } from "@/components/ui/use-dialog";
import { TONE_CLASSES } from "./notificationVisuals";
import {
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  SEARCH_SUGGESTIONS,
  navCommandsFor,
  isNavCommandAllowed,
  filterNavCommands,
  buildResultGroups,
  metaChips,
  highlightSegments,
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
 *
 * Keyboard model: this is a combobox with an owned listbox. Focus never leaves
 * the input — ↑/↓ move `aria-activedescendant` over the rows, Enter opens the
 * active one, Tab is trapped inside the dialog, and Escape closes it and hands
 * focus back to whatever opened it. Rows are `tabIndex={-1}` on purpose: forty
 * results should not be forty stops on the way to the close button.
 *
 * The trap, the scroll lock and the focus restore are the ui kit's `useDialog`
 * — the same hook `Modal` and `Drawer` run on — rather than a second hand-made
 * copy. `Modal` itself is not used here because it pads and centres its body,
 * and a command palette is top-aligned with an edge-to-edge input; the shared
 * part of a dialog is the behaviour, and that is what is shared.
 */

const KBD =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-sans text-[10px] font-semibold text-muted-foreground";

/** A result-shaped placeholder. Same 3-line geometry as a real row. */
function ResultSkeleton() {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

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
  const panelRef = useRef(null);
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
    if (!open) return;

    // Re-read on every open rather than once on mount: the session can change
    // under a long-lived shell, and a stale role would show forbidden sections.
    setOrgCtx(getOrgContext());
    setRecents(loadRecentSearches());
    setActiveIndex(0);
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
  const activeRow = flat[safeIndex] || null;
  const activeOptionId = activeRow ? `palette-option-${safeIndex}` : undefined;

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

  // Focus trap, Escape, body scroll lock and focus restore — the ui kit's own
  // dialog behaviour, so the palette cannot drift away from Modal and Drawer.
  // It focuses the first focusable element in the panel, which is the input.
  useDialog({ open, onClose: close, containerRef: panelRef });

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
    if (event.key === "Home" && flat.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && flat.length > 0) {
      event.preventDefault();
      setActiveIndex(flat.length - 1);
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
  const hasRows = groups.length > 0;
  // A first search shows placeholders; a re-search keeps the rows that are
  // already on screen and only marks the list busy, so the panel never
  // collapses to empty and springs back.
  const showSkeleton = isSearchMode && loading && !error && !hasRows;
  const showEmpty = isSearchMode && !loading && !error && !hasRows;
  const showNoCommands = !isSearchMode && !showKeepTyping && !hasRows;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center sm:p-6 sm:pt-[10vh]">
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-full flex-col overflow-hidden bg-card",
          "sm:h-auto sm:max-h-[70vh] sm:max-w-2xl sm:rounded-xl sm:border sm:border-border sm:shadow-elevated",
          "animate-fade-in motion-reduce:animate-none"
        )}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search projects, tasks, people…"
            aria-label="Search projects, tasks, people"
            role="combobox"
            aria-expanded={hasRows}
            aria-controls="palette-results"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck="false"
            // outline-none is safe here and only here: focus is moved into this
            // input the moment the dialog opens and is trapped so it can never
            // leave, so a ring would be drawn permanently around the one field
            // on screen. The caret and the highlighted row are the indicator.
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          {loading && (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close search">
            <X aria-hidden="true" />
          </Button>
        </div>

        {/* Body */}
        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Search results"
          aria-busy={loading || undefined}
          className="flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {showKeepTyping && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Keep typing — {MIN_QUERY_LENGTH} characters minimum to search.
            </p>
          )}

          {error && (
            <ErrorState
              className="m-2"
              title="Search didn't run"
              description={error}
              onRetry={() => setRetryToken((token) => token + 1)}
              retryLabel="Retry"
              icon={RotateCw}
            />
          )}

          {showSkeleton && (
            <div className="space-y-1" aria-hidden="true">
              <div className="px-3 pb-1 pt-3">
                <Skeleton className="h-2.5 w-20" />
              </div>
              <ResultSkeleton />
              <ResultSkeleton />
              <ResultSkeleton />
              <div className="px-3 pb-1 pt-3">
                <Skeleton className="h-2.5 w-16" />
              </div>
              <ResultSkeleton />
              <ResultSkeleton />
            </div>
          )}

          {showEmpty && (
            <EmptyState
              icon={SearchX}
              className="m-2 border-0 bg-transparent py-8"
              title={`No results for “${term}”`}
              description={
                <>
                  Nothing in this organization matched. Try a shorter term, check the spelling, or
                  search for {SEARCH_SUGGESTIONS.slice(0, 3).join(", ")}.
                </>
              }
            />
          )}

          {showNoCommands && (
            <EmptyState
              icon={Command}
              className="m-2 border-0 bg-transparent py-8"
              title="No matching commands"
              description={`Nothing in the menu is called “${term}”. Type ${MIN_QUERY_LENGTH} characters or more to search records instead.`}
            />
          )}

          {truncated && isSearchMode && !error && hasRows && (
            <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
              Showing partial results — narrow the search to see everything.
            </p>
          )}

          {groups.map((group) => (
            <section key={group.key} className="mb-1" role="group" aria-label={group.label}>
              <div className="flex items-center justify-between px-3 pb-1 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.key === "recents" ? (
                  <Button variant="ghost" size="xs" onClick={handleClearRecents}>
                    Clear
                  </Button>
                ) : (
                  group.count && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {group.count}
                    </span>
                  )
                )}
              </div>

              {/* The list markup is scaffolding only: the accessible tree is
                  listbox → group → option, so the ul/li carry no role. */}
              <ul role="presentation">
                {group.rows.map((row) => (
                  <li key={row.key} role="presentation">
                    <PaletteRow
                      row={row}
                      term={term}
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

        {/* Footer legend. Shown at every width: the shortcut hints are the only
            thing on screen that teaches the palette how to be driven. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className={KBD} aria-hidden="true">
              <ArrowUp className="h-3 w-3" />
            </span>
            <span className={KBD} aria-hidden="true">
              <ArrowDown className="h-3 w-3" />
            </span>
            Navigate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={KBD} aria-hidden="true">
              <CornerDownLeft className="h-3 w-3" />
            </span>
            Open
          </span>
          <span className="inline-flex items-center gap-1.5 sm:ml-auto">
            <span className={KBD} aria-hidden="true">
              esc
            </span>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}

/** Render a string with the matched runs marked. */
function Highlighted({ text, term }) {
  const segments = highlightSegments(text, term);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          // <mark> and not a span: "these characters are why this row is here"
          // is exactly what the element means, and it survives a text-only view.
          <mark
            key={index}
            className="rounded-[3px] bg-warning/25 px-0.5 text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

function PaletteRow({ row, term, active, onActivate, onHover, registerRef }) {
  const Icon = row.icon;
  const chips = metaChips(row.meta);
  // Only a real search has matched characters to point at; a launcher command
  // filtered by the same string does too, but a recent term is the string.
  const highlightTerm = row.kind === "recent" ? "" : term;

  const body = (
    <>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          TONE_CLASSES[row.tone] || TONE_CLASSES.muted
        )}
      >
        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          <Highlighted text={row.title} term={highlightTerm} />
        </span>
        {/* `subtitle` is nullable by contract — an absent one collapses the line. */}
        {row.subtitle && (
          <span className="block truncate text-xs text-muted-foreground">
            <Highlighted text={row.subtitle} term={highlightTerm} />
          </span>
        )}
        {chips.length > 0 && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {chips.map((chip) => (
              <Badge key={chip.key} variant="secondary" size="sm">
                {chip.value}
              </Badge>
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
        <Badge variant="outline" size="sm" className="shrink-0 self-center">
          No link
        </Badge>
      </div>
    );
  }

  return (
    <button
      ref={registerRef}
      type="button"
      id={`palette-option-${row.flatIndex}`}
      role="option"
      aria-selected={active}
      // Focus stays in the input; the highlight is what moves. Tab therefore
      // skips the rows entirely and reaches the close button in one press.
      tabIndex={-1}
      onClick={() => onActivate(row)}
      // onMouseMove, not onMouseEnter: arrowing down scrolls the list under a
      // stationary cursor, and an enter event fired by that scroll would yank
      // the highlight back. Only a real pointer movement takes it over.
      onMouseMove={() => onHover(row.flatIndex)}
      className={cn(
        "relative flex w-full items-start gap-3 rounded-lg py-2.5 pl-4 pr-3 text-left transition-colors duration-150 motion-reduce:transition-none",
        // The active row is not just "a bit greyer": a tint, a ring and a solid
        // left bar, so it is unmistakable at a glance and still legible with
        // colour stripped out.
        active ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-muted/60"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-1.5 left-1 w-0.5 rounded-full",
          active ? "bg-primary" : "bg-transparent"
        )}
      />
      {body}
      {active && (
        <span className="shrink-0 self-center text-muted-foreground" aria-hidden="true">
          <CornerDownLeft className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}
