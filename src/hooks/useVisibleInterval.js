"use client";

/**
 * Polling that stops while the tab is hidden.
 *
 * Every polling loop in the app ran unconditionally, so a dashboard left open
 * in a background tab kept issuing its full query set — the Developer Activity
 * screen alone re-ran six to sixteen requests every ten seconds, forever, for
 * nobody to look at. Most of those tables also carry a realtime subscription,
 * so the poll is a fallback rather than the primary path and pausing it loses
 * nothing: the callback fires once on the way back, so the view is current
 * again as soon as it is looked at.
 */

/**
 * Drop-in replacement for the `setInterval` + `clearInterval` pair used inside
 * a `useEffect`. Returns the cleanup directly:
 *
 *   useEffect(() => setVisibleInterval(fetchThings, 10_000), [fetchThings]);
 *
 * @param {Function} callback  invoked per tick, and once when the tab is shown
 * @param {number} delayMs     falsy disables polling entirely
 * @returns {Function} cleanup that clears the timer and the listener
 */
export function setVisibleInterval(callback, delayMs) {
  if (typeof callback !== "function" || !delayMs) return () => {};

  let intervalId = null;

  const isHidden = () =>
    typeof document !== "undefined" && document.visibilityState === "hidden";

  const start = () => {
    if (intervalId === null) intervalId = setInterval(callback, delayMs);
  };

  const stop = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const onVisibilityChange = () => {
    if (isHidden()) {
      stop();
      return;
    }
    // Coming back: refresh straight away rather than waiting out a full period
    // on data that went stale while the tab was in the background.
    try {
      callback();
    } catch {
      /* a failed refresh must not stop the timer restarting */
    }
    start();
  };

  if (!isHidden()) start();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    stop();
  };
}

export default setVisibleInterval;
