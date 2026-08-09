"use client";

/**
 * Scroll progress for a single element, measured against the viewport.
 *
 * Scroll fires far more often than a frame can be painted — on a trackpad it is
 * routine to get several events per frame — so the listener does nothing but
 * schedule one `requestAnimationFrame`. Measurement (a single
 * `getBoundingClientRect`, which is the only forced layout in the whole path)
 * happens once per frame at most, no matter how many events arrived.
 *
 * The listener is registered `{ passive: true }` so the browser never has to
 * wait to find out whether we intend to `preventDefault` the scroll.
 */

import { useEffect, useRef, useState } from "react";

/**
 * Two mappings, because "scroll progress" means two different things depending
 * on where the element sits.
 *
 * `"enter"` — 0 when the element's top edge is on the bottom of the viewport,
 *   1 when its bottom edge has passed the top. The right answer for a section
 *   part-way down the page that should animate as it passes through.
 *
 * `"cover"` — 0 while the element's top is at or below the top of the viewport,
 *   1 once its bottom edge reaches the top. The right answer for a hero, which
 *   is already on screen at first paint: `"enter"` would report a hero at the
 *   top of the page as roughly 60% progressed before the visitor has touched
 *   the wheel, which for an animation that resolves from chaos into order means
 *   the first frame gives away the ending.
 */
function measure(el, mode) {
  const rect = el.getBoundingClientRect();
  const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;

  let travelled;
  let total;

  if (mode === "cover") {
    travelled = -rect.top;
    total = rect.height;
  } else {
    travelled = viewportH - rect.top;
    // Distance from "just below the fold" to "just above it".
    total = rect.height + viewportH;
  }

  // Zero-height element, or a zero-height window: no travel to report.
  if (total <= 0) return 0;
  if (travelled <= 0) return 0;
  if (travelled >= total) return 1;
  return travelled / total;
}

/**
 * @param {{ current: HTMLElement | null }} targetRef  element to measure
 * @param {Object}   [options]
 * @param {(progress: number) => void} [options.onProgress]
 *        Called with the raw 0→1 value on every measured frame. **Supplying
 *        this puts the hook in subscription mode: it stops calling `setState`
 *        entirely**, so a 60fps scroll costs zero React renders. This is what
 *        the WebGL scene uses — it wants the value inside its own rAF loop, and
 *        re-rendering React sixty times a second to deliver a float would be
 *        pure waste. The returned value stays at 0 in this mode.
 * @param {number}   [options.step=0.01]
 *        Quantisation for the returned state, ignored in subscription mode.
 *        State only updates when progress moves by at least this much, capping
 *        renders at ~1/step for a full pass instead of one per frame.
 * @param {boolean}  [options.disabled=false]
 *        Attach nothing at all. Used by the reduced-motion path so the static
 *        composition carries no scroll listener whatsoever.
 * @param {"enter"|"cover"} [options.mode="enter"]
 *        See `measure` above. Heroes want `"cover"`.
 * @returns {number} progress in [0, 1]
 */
export function useScrollProgress(targetRef, options = {}) {
  const { onProgress = null, step = 0.01, disabled = false, mode = "enter" } = options;

  const [progress, setProgress] = useState(0);

  // Held in refs so that a caller passing an inline arrow function does not
  // tear down and re-attach the listeners on every render.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const subscribeOnly = onProgress !== null;

  useEffect(() => {
    if (disabled) return undefined;
    if (typeof window === "undefined") return undefined;

    const el = targetRef?.current;
    if (!el) return undefined;

    let frame = null;
    let last = -1;
    let cancelled = false;

    const read = () => {
      frame = null;
      if (cancelled) return;

      const value = measure(el, mode);

      const notify = onProgressRef.current;
      if (notify) {
        notify(value);
        return;
      }

      // Snap to the ends so the caller reliably sees exact 0 and 1 even when
      // `step` would otherwise leave it a hair short.
      const snapped = value <= 0 ? 0 : value >= 1 ? 1 : value;
      if (last < 0 || Math.abs(snapped - last) >= step || snapped === 0 || snapped === 1) {
        if (snapped !== last) {
          last = snapped;
          setProgress(snapped);
        }
      }
    };

    const schedule = () => {
      // Already have a frame pending — the extra events collapse into it.
      if (frame !== null) return;
      frame = window.requestAnimationFrame(read);
    };

    // Measure immediately: the element may already be part-way up the page on
    // a restored scroll position or a deep link.
    read();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    // Layout can change without a scroll or a window resize — fonts landing,
    // an image sizing itself, a sibling section expanding.
    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(el);
    }

    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (resizeObserver) resizeObserver.disconnect();
    };
    // `subscribeOnly` is included because switching modes changes what the
    // effect does; `onProgress` itself is deliberately not a dependency.
  }, [targetRef, step, disabled, subscribeOnly, mode]);

  return subscribeOnly ? 0 : progress;
}

export default useScrollProgress;
