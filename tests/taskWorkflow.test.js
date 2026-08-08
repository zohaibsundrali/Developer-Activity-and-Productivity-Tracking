import { describe, it, expect } from "vitest";
import {
  BOARD_COLUMNS,
  DRAGGABLE_COLUMNS,
  REVIEW_ONLY_STATUSES,
  REVIEWABLE_STATUSES,
  STATUS_TRANSITIONS,
  allowedTransitions,
  isTransitionAllowed,
  normalizeStatus,
  formatDuration,
} from "@/utils/pmData";

/**
 * The task lifecycle is the rule the rest of the product leans on: `completed`
 * and `rejected` carry productivity points, a review record and the project
 * rollup, so they must be unreachable from a board drag or a dropdown.
 *
 * These cover the pure decision logic. The database backstops that catch a
 * writer bypassing it live in migrations 021 and 024.
 */

const TERMINAL = ["completed", "rejected"];

describe("lifecycle shape", () => {
  it("exposes the five pipeline columns in order", () => {
    expect(BOARD_COLUMNS.map((c) => c.id)).toEqual([
      "pending",
      "in_progress",
      "awaiting_approval",
      "completed",
      "rejected",
    ]);
  });

  it("offers only non-terminal columns as drag targets", () => {
    const draggable = DRAGGABLE_COLUMNS.map((c) => c.id);
    for (const s of TERMINAL) expect(draggable).not.toContain(s);
    expect(draggable).toEqual(["pending", "in_progress", "awaiting_approval"]);
  });

  it("treats exactly completed and rejected as review-owned", () => {
    expect([...REVIEW_ONLY_STATUSES].sort()).toEqual(TERMINAL);
  });

  it("only allows review from a submitted state", () => {
    expect([...REVIEWABLE_STATUSES].sort()).toEqual(["awaiting_approval", "reviewed"]);
  });
});

describe("no hand-driven path reaches a terminal status", () => {
  const everyFrom = [...Object.keys(STATUS_TRANSITIONS), "reviewed", undefined, null, "bogus"];

  // A drop onto the column a task already sits in is a no-op, not a transition,
  // so `from === to` is excluded here and covered separately below.
  it.each(TERMINAL)("refuses a move to %s from anywhere else", (to) => {
    for (const from of everyFrom.filter((f) => f !== to)) {
      expect(isTransitionAllowed(from, to)).toBe(false);
    }
  });

  it("lists no terminal status as a legal next step", () => {
    for (const from of Object.keys(STATUS_TRANSITIONS)) {
      for (const to of allowedTransitions(from)) {
        expect(TERMINAL).not.toContain(to);
      }
    }
  });
});

describe("legal moves", () => {
  it("walks the pipeline forward", () => {
    expect(isTransitionAllowed("pending", "in_progress")).toBe(true);
    expect(isTransitionAllowed("in_progress", "awaiting_approval")).toBe(true);
  });

  it("lets a mistakenly submitted task be pulled back", () => {
    expect(isTransitionAllowed("awaiting_approval", "in_progress")).toBe(true);
  });

  it("lets rejected work be picked up again", () => {
    expect(isTransitionAllowed("rejected", "in_progress")).toBe(true);
  });

  it("does not send rejected work straight back to review", () => {
    expect(isTransitionAllowed("rejected", "awaiting_approval")).toBe(false);
  });

  it("seals an approved task", () => {
    expect(allowedTransitions("completed")).toEqual([]);
    expect(isTransitionAllowed("completed", "in_progress")).toBe(false);
    expect(isTransitionAllowed("completed", "pending")).toBe(false);
  });

  it("treats a no-op move as allowed so a drop onto the same column is not an error", () => {
    for (const s of [...Object.keys(STATUS_TRANSITIONS), "reviewed"]) {
      expect(isTransitionAllowed(s, s)).toBe(true);
    }
  });

  it("refuses a move with no target", () => {
    expect(isTransitionAllowed("pending", null)).toBe(false);
    expect(isTransitionAllowed("pending", undefined)).toBe(false);
    expect(isTransitionAllowed("pending", "")).toBe(false);
  });
});

describe("normalizeStatus", () => {
  it("keeps rejected visible instead of folding it into To Do", () => {
    // Aliasing it hid failed work among fresh work, where it could be picked up
    // and closed as though it had never been reviewed.
    expect(normalizeStatus("rejected")).toBe("rejected");
  });

  it("maps off-pipeline synonyms onto a real column", () => {
    expect(normalizeStatus("reviewed")).toBe("awaiting_approval");
    expect(normalizeStatus("in_review")).toBe("awaiting_approval");
    expect(normalizeStatus("todo")).toBe("pending");
    expect(normalizeStatus("open")).toBe("pending");
    expect(normalizeStatus("doing")).toBe("in_progress");
    expect(normalizeStatus("done")).toBe("completed");
    expect(normalizeStatus("approved")).toBe("completed");
  });

  it("falls back to To Do for anything unrecognised", () => {
    for (const v of [null, undefined, "", "nonsense", 42]) {
      expect(normalizeStatus(v)).toBe("pending");
    }
  });
});

describe("formatDuration", () => {
  it("renders seconds, minutes and hours", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(2 * 3600)).toBe("2h");
    expect(formatDuration(2 * 3600 + 15 * 60)).toBe("2h 15m");
  });

  it("never renders a negative or non-numeric duration", () => {
    expect(formatDuration(-500)).toBe("0s");
    expect(formatDuration(null)).toBe("0s");
    expect(formatDuration(undefined)).toBe("0s");
    expect(formatDuration("abc")).toBe("0s");
  });
});
