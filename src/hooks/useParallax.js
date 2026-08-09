"use client";

/**
 * Slow parallax for decorative section backgrounds.
 *
 * Built on `useScrollProgress` in **subscription mode**: the scroll listener is
 * passive, collapses every event into at most one `requestAnimationFrame`, and
 * the frame callback writes a `transform` straight onto the layer's style. No
 * React state is touched, so a full-speed scroll costs zero renders and zero
 * reconciliation — the only work per frame is one `getBoundingClientRect` and
 * one string assignment.
 *
 * `translate3d` on a decorative, `aria-hidden` layer cannot shift layout: the
 * layer is absolutely positioned inside an `overflow-hidden` section and is
 * sized with enough bleed that the travel never exposes an edge.
 *
 * Disabled outright under `prefers-reduced-motion: reduce` — the effect never
 * attaches a listener and the layer keeps its untransformed position.
 */

import { useEffect, useRef } from "react";
import { useScrollProgress } from "@/hooks/useScrollProgress";
import { usePrefersReducedMotion } from "@/hooks/useReveal";

/**
 * @param {Object} [options]
 * @param {number} [options.distance=70]
 *        Total vertical travel in pixels across a full pass of the section.
 *        Positive values move the layer *down* as the page scrolls up, i.e. the
 *        layer appears to lag behind the content.
 * @returns {{ sectionRef: Object, layerRef: Object }}
 *        Put `sectionRef` on the section that defines the scroll range and
 *        `layerRef` on the decorative element to move.
 */
export function useParallax(options = {}) {
  const { distance = 70 } = options;

  const sectionRef = useRef(null);
  const layerRef = useRef(null);
  const reduced = usePrefersReducedMotion();

  useScrollProgress(sectionRef, {
    disabled: reduced,
    onProgress: (progress) => {
      const layer = layerRef.current;
      if (!layer) return;
      // Centre the travel on the section so the layer sits at its authored
      // position when the section is mid-viewport.
      const offset = (progress - 0.5) * distance;
      layer.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    },
  });

  // If the preference flips to "reduce" while the page is open, put the layer
  // back where the stylesheet says it belongs.
  useEffect(() => {
    if (!reduced) return;
    const layer = layerRef.current;
    if (layer) layer.style.transform = "";
  }, [reduced]);

  return { sectionRef, layerRef };
}

export default useParallax;
