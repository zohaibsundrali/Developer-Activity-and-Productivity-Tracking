"use client";

/**
 * Scroll-reveal primitives for the marketing page.
 *
 * Three rules shape everything in this file:
 *
 * 1. **No element may ever be stranded at `opacity: 0`.** The server renders the
 *    page fully visible. Animation is *armed* on the client, in a layout effect,
 *    only once we know an IntersectionObserver exists and the visitor has not
 *    asked for reduced motion. A visitor with JS disabled, a crawler, or someone
 *    with `prefers-reduced-motion: reduce` sees the finished page — never a
 *    blank one waiting for a callback that will not come.
 *
 * 2. **Only `transform` and `opacity` animate.** Both are composited; neither
 *    triggers layout. Nothing here reserves or consumes space differently before
 *    and after revealing, so nothing shifts.
 *
 * 3. **Observers are one-shot.** `once: true` disconnects on first intersection,
 *    so a long page does not accumulate live observers as the visitor scrolls.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * `useLayoutEffect` warns when it runs during server rendering. The arming step
 * genuinely wants to be pre-paint (otherwise a below-the-fold element paints
 * visible for one frame and then snaps to hidden), so on the client we want the
 * layout variant and on the server we want the no-op.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** True when the platform can actually run the reveal. */
function motionIsAvailable() {
  if (typeof window === "undefined") return false;
  if (typeof IntersectionObserver === "undefined") return false;
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Reactive `prefers-reduced-motion`. Starts `false` so the first client render
 * matches the server, then corrects itself before paint and keeps listening —
 * a visitor who flips the OS setting mid-visit gets the static treatment
 * without a reload.
 *
 * @returns {boolean} true when the visitor has asked for reduced motion
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setReduced(query.matches);

    sync();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    }
    // Safari < 14.
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  return reduced;
}

/**
 * Reveal one element when it approaches the viewport.
 *
 * The returned `state` is a three-value machine rather than a boolean, and the
 * distinction is the whole safety story:
 *
 *   `"static"`   — animation was never armed. Render the element plainly, with
 *                  no inline opacity or transform at all. This is the SSR state,
 *                  the reduced-motion state and the no-IntersectionObserver
 *                  state.
 *   `"hidden"`   — armed and waiting. Faded out and offset.
 *   `"revealed"` — armed and triggered. Transitioning to its resting pose.
 *
 * @param {Object}  [options]
 * @param {boolean} [options.once=true]        stop observing after first reveal
 * @param {string}  [options.rootMargin]
 *        Two jobs. The positive **bottom** margin grows the root box downward,
 *        so elements begin revealing slightly *before* they cross the fold and
 *        are already settling by the time they are read.
 *
 *        The enormous **top** margin is a correctness fix, not a tuning knob.
 *        IntersectionObserver samples once per frame; a visitor who drags the
 *        scrollbar, presses End, or follows a deep link can move an element from
 *        below the fold to above it between two samples, and the observer then
 *        reports "not intersecting" both times and never fires — leaving that
 *        element stranded at `opacity: 0` for the rest of the visit. Measured at
 *        375px with a fast programmatic scroll: 14 elements stranded before this
 *        margin, 0 after. Extending the root upward means anything the viewport
 *        has already passed counts as intersecting, which is also the honest
 *        answer — content you have scrolled past should be visible.
 * @param {number}  [options.threshold=0]      fraction of the element required
 * @param {boolean} [options.disabled=false]   force the static path
 * @returns {{ ref: Object, state: "static"|"hidden"|"revealed", revealed: boolean, animating: boolean }}
 */
export function useReveal(options = {}) {
  const {
    once = true,
    rootMargin = "100000px 0px 12% 0px",
    threshold = 0,
    disabled = false,
  } = options;

  const ref = useRef(null);
  const [state, setState] = useState("static");

  useIsomorphicLayoutEffect(() => {
    if (disabled) {
      setState("static");
      return undefined;
    }
    if (!motionIsAvailable()) {
      // Reduced motion, or a browser without IntersectionObserver. Stay static:
      // the element is already fully painted and stays that way.
      setState("static");
      return undefined;
    }

    const el = ref.current;
    if (!el) return undefined;

    // Arm. This runs before paint, so the element never flashes in and out.
    setState("hidden");

    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            if (!once) setState("hidden");
            continue;
          }
          if (cancelled) return;
          setState("revealed");
          if (once) observer.disconnect();
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(el);

    // A visitor who arrives with reduced motion switched on mid-session, or who
    // switches it on while the page is open, must not be left holding an
    // invisible element.
    let query = null;
    const onPreferenceChange = () => {
      if (typeof window.matchMedia !== "function") return;
      if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
        cancelled = true;
        observer.disconnect();
        setState("static");
      }
    };
    if (typeof window.matchMedia === "function") {
      query = window.matchMedia(REDUCED_MOTION_QUERY);
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", onPreferenceChange);
      } else if (typeof query.addListener === "function") {
        query.addListener(onPreferenceChange);
      }
    }

    return () => {
      cancelled = true;
      observer.disconnect();
      if (query) {
        if (typeof query.removeEventListener === "function") {
          query.removeEventListener("change", onPreferenceChange);
        } else if (typeof query.removeListener === "function") {
          query.removeListener(onPreferenceChange);
        }
      }
    };
  }, [once, rootMargin, threshold, disabled]);

  return {
    ref,
    state,
    /** True whenever the element should be readable — including the static path. */
    revealed: state !== "hidden",
    /** True only when inline motion styles should be applied. */
    animating: state !== "static",
  };
}

/**
 * Fire a callback the first time an element approaches the viewport, without
 * driving any visual state. Used by the counters, which want to *start* on
 * reveal but own their own animation.
 *
 * Unlike `useReveal` this one still fires under reduced motion — the consumer
 * decides what "start" means (a count-up, or simply writing the final value).
 *
 * @param {() => void} onEnter
 * @param {Object} [options]
 * @param {string} [options.rootMargin]
 * @returns {Object} ref to attach to the observed element
 */
export function useOnEnter(onEnter, options = {}) {
  // Same enormous top margin as `useReveal`, for the same reason: a counter the
  // viewport has already flown past must still end up showing its number.
  const { rootMargin = "100000px 0px 12% 0px", threshold = 0 } = options;

  const ref = useRef(null);
  const handlerRef = useRef(onEnter);
  handlerRef.current = onEnter;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      // No observer: the content is on the page, so treat it as entered rather
      // than leaving a counter frozen at its start value.
      handlerRef.current?.();
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();
          handlerRef.current?.();
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return ref;
}

/**
 * Track which of several stacked blocks is currently the "active" one, for the
 * pinned panel in the role-stories section. A single observer watches every
 * block; the one closest to the middle of the viewport wins.
 *
 * @param {number} count number of blocks
 * @returns {{ setItemRef: (index: number) => (el: HTMLElement|null) => void, activeIndex: number }}
 */
export function useActiveBlock(count) {
  const itemsRef = useRef([]);
  // Ref callbacks are cached per index. A fresh closure on every render would
  // make React detach and re-attach every block on every render, briefly
  // emptying the array the observer effect reads from.
  const callbacksRef = useRef(new Map());
  const [activeIndex, setActiveIndex] = useState(0);

  const setItemRef = useCallback((index) => {
    const cache = callbacksRef.current;
    if (!cache.has(index)) {
      cache.set(index, (el) => {
        itemsRef.current[index] = el;
      });
    }
    return cache.get(index);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;

    const nodes = itemsRef.current.filter(Boolean);
    if (nodes.length === 0) return undefined;

    // Ratios are kept in a map and reduced to a winner, rather than reacting to
    // whichever entry happened to fire last — that avoids the panel flickering
    // between two neighbours as they cross the band together.
    const ratios = new Map();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        let bestIndex = -1;
        let bestRatio = 0;
        nodes.forEach((node, index) => {
          const ratio = ratios.get(node) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIndex = index;
          }
        });

        if (bestIndex >= 0) setActiveIndex(bestIndex);
      },
      {
        // A band across the middle of the viewport: a block is "active" while it
        // occupies the reading zone, not merely while it is on screen.
        rootMargin: "-35% 0px -35% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [count]);

  return { setItemRef, activeIndex };
}

export default useReveal;
