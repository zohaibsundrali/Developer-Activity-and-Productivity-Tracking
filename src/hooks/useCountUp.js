"use client";

/**
 * Count a stat up from zero when it is revealed.
 *
 * The values on the page are written by hand as display strings — `"10K+"`,
 * `"99.9%"`, `"4.9"`, `"1,200"` — so the hook does not take a number. It splits
 * the string into prefix / number / suffix, animates only the numeric middle,
 * and re-renders the original formatting around it. Anything with no number in
 * it (an em dash, a word) is passed straight through and never animates.
 *
 * Under `prefers-reduced-motion: reduce` the hook returns the final string on
 * the very first render and starts no timer at all.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/useReveal";

/** Splits `"$1,200+"` into `{ prefix: "$", value: 1200, suffix: "+", ... }`. */
function parse(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/^(\D*?)(\d[\d,\s]*(?:\.\d+)?)(.*)$/s);
  if (!match) return null;

  const [, prefix, rawNumber, suffix] = match;
  const normalised = rawNumber.replace(/[,\s]/g, "");
  const value = Number.parseFloat(normalised);
  if (!Number.isFinite(value)) return null;

  const dot = normalised.indexOf(".");
  return {
    prefix,
    suffix,
    value,
    decimals: dot === -1 ? 0 : normalised.length - dot - 1,
    grouped: /[,\s]/.test(rawNumber),
  };
}

function format(parsed, current) {
  const fixed = current.toFixed(parsed.decimals);
  const body = parsed.grouped
    ? Number.parseFloat(fixed).toLocaleString("en-US", {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      })
    : fixed;
  return `${parsed.prefix}${body}${parsed.suffix}`;
}

/** Fast start, long settle — the same family as the reveal easing. */
function easeOutExpo(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * @param {string} text     the final display string, e.g. `"40%"`
 * @param {Object} [options]
 * @param {boolean} [options.start=false]  begin counting (set on reveal)
 * @param {number}  [options.duration=1400] milliseconds
 * @returns {string} the string to render this frame
 */
export function useCountUp(text, options = {}) {
  const { start = false, duration = 1400 } = options;

  const reduced = usePrefersReducedMotion();
  const parsed = parse(text);
  const animatable = parsed !== null && !reduced;

  // Seeded with the final text so that the server render, the no-JS render and
  // the reduced-motion render all show the real number immediately.
  const [display, setDisplay] = useState(text);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!animatable || !start) {
      setDisplay(text);
      return undefined;
    }

    const from = 0;
    const to = parsed.value;
    let startTime = null;

    const tick = (now) => {
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
      const current = from + (to - from) * easeOutExpo(t);

      setDisplay(format(parsed, t >= 1 ? to : current));

      if (t < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        // Land on the author's exact string, not our re-formatting of it.
        setDisplay(text);
      }
    };

    setDisplay(format(parsed, from));
    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // `parsed` is derived from `text`; depending on `text` keeps the identity stable.
  }, [text, start, duration, animatable]); // eslint-disable-line react-hooks/exhaustive-deps

  return display;
}

export default useCountUp;
