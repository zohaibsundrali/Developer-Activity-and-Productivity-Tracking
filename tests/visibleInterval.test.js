import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setVisibleInterval } from "@/hooks/useVisibleInterval";

/**
 * Every polling loop in the app ran unconditionally, so a dashboard left open
 * in a background tab kept issuing its full query set for nobody. These cover
 * the guard that replaced the raw setInterval: it must stop when the tab is
 * hidden, catch up once on return, and never leave a timer or listener behind.
 */

let visibility;
const listeners = new Set();

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  listeners.clear();
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type, fn) => {
      if (type === "visibilitychange") listeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === "visibilitychange") listeners.delete(fn);
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function hide() {
  visibility = "hidden";
  listeners.forEach((fn) => fn());
}
function show() {
  visibility = "visible";
  listeners.forEach((fn) => fn());
}

describe("setVisibleInterval", () => {
  it("ticks on schedule while visible", () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 1000);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops ticking once the tab is hidden", () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 1000);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);

    hide();
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(2); // an hour of hidden time costs nothing
    stop();
  });

  it("refreshes immediately on return rather than waiting a full period", () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 10_000);
    hide();
    vi.advanceTimersByTime(50_000);
    expect(fn).toHaveBeenCalledTimes(0);

    show();
    expect(fn).toHaveBeenCalledTimes(1); // caught up at once
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(2); // and resumed
    stop();
  });

  it("never starts a timer when it begins hidden", () => {
    visibility = "hidden";
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 1000);
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it("clears both the timer and the listener on cleanup", () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 1000);
    expect(listeners.size).toBe(1);

    stop();
    expect(listeners.size).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not double-start if visibility fires twice while visible", () => {
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 1000);
    show();
    show();
    fn.mockClear();
    vi.advanceTimersByTime(1000);
    // One timer, so one tick — not one per spurious event.
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps polling when the callback throws on the catch-up call", () => {
    const fn = vi.fn(() => {
      throw new Error("transient fetch failure");
    });
    const stop = setVisibleInterval(fn, 1000);
    hide();
    expect(() => show()).not.toThrow();
    fn.mockImplementation(() => {});
    vi.advanceTimersByTime(2000);
    expect(fn.mock.calls.length).toBeGreaterThan(1);
    stop();
  });

  it("is inert without a delay or a callback", () => {
    const fn = vi.fn();
    setVisibleInterval(fn, 0)();
    setVisibleInterval(null, 1000)();
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
