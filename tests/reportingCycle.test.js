import { describe, it, expect } from "vitest";
import { reportingCycleError, MAX_REPORTING_DEPTH } from "@/utils/employeesData";

/**
 * `memberships.reports_to` is a loose uuid pointing at another member's
 * user_id, so nothing about the column stops it closing a loop. Migration 037
 * refuses cycles in the database — that is the enforcement, and it covers
 * writers that never touch this file. `reportingCycleError` exists to say why
 * in a sentence, before the write, from the directory already in memory.
 *
 * These tests are the client-side half of the same proof run against Postgres
 * in 037's verification: two-node loop, longer loop, self-reference, legal
 * chain, clearing to null, and a bounded walk over data that is already cyclic.
 */

const A = "aaaa-1";
const B = "bbbb-2";
const C = "cccc-3";
const D = "dddd-4";

// loadEmployees() shape, trimmed to the fields the check reads.
const emp = (userId, name, reportsTo = null) => ({ userId, name, reportsTo });

describe("reportingCycleError", () => {
  describe("refuses cycles", () => {
    it("refuses a two-node loop: A already reports to B, so B cannot report to A", () => {
      const employees = [emp(A, "Ada", B), emp(B, "Bo", null)];
      const message = reportingCycleError({ employees, userId: B, reportsTo: A });
      expect(message).toBeTruthy();
      expect(message).toContain("reporting loop");
      // The names, not the uuids — this string is shown to a person.
      expect(message).toContain("Ada");
      expect(message).toContain("Bo");
    });

    it("refuses a three-node loop: A->B->C, so C cannot report to A", () => {
      const employees = [emp(A, "Ada", B), emp(B, "Bo", C), emp(C, "Cy", null)];
      const message = reportingCycleError({ employees, userId: C, reportsTo: A });
      expect(message).toBeTruthy();
      expect(message).toContain("indirectly");
      // The chain that closes the loop is spelled out.
      expect(message).toContain("Ada");
      expect(message).toContain("Bo");
    });

    it("refuses self-reference", () => {
      const employees = [emp(A, "Ada", null)];
      expect(reportingCycleError({ employees, userId: A, reportsTo: A })).toBe(
        "Ada cannot report to themselves."
      );
    });

    it("refuses self-reference even when the employee is not in the loaded list", () => {
      expect(reportingCycleError({ employees: [], userId: A, reportsTo: A })).toContain(
        "cannot report to themselves"
      );
    });

    it("compares ids as strings, so a numeric id and its string form are the same person", () => {
      const employees = [emp(7, "Seven", null)];
      expect(reportingCycleError({ employees, userId: 7, reportsTo: "7" })).toBeTruthy();
    });

    it("refuses a loop that closes several levels up a deep chain", () => {
      // e1 -> e2 -> ... -> e20, then e20 tries to report to e1.
      const employees = [];
      for (let i = 1; i <= 20; i += 1) {
        employees.push(emp(`e${i}`, `Emp ${i}`, i < 20 ? `e${i + 1}` : null));
      }
      const message = reportingCycleError({ employees, userId: "e20", reportsTo: "e1" });
      expect(message).toContain("reporting loop");
    });
  });

  describe("accepts legal lines", () => {
    it("accepts a straight chain A->B->C", () => {
      const employees = [emp(A, "Ada", null), emp(B, "Bo", C), emp(C, "Cy", null)];
      expect(reportingCycleError({ employees, userId: A, reportsTo: B })).toBeNull();
    });

    it("accepts clearing the manager (null / empty string / undefined)", () => {
      const employees = [emp(A, "Ada", B), emp(B, "Bo", null)];
      expect(reportingCycleError({ employees, userId: A, reportsTo: null })).toBeNull();
      expect(reportingCycleError({ employees, userId: A, reportsTo: "" })).toBeNull();
      expect(reportingCycleError({ employees, userId: A, reportsTo: undefined })).toBeNull();
    });

    it("accepts two people reporting to the same manager — a tree is not a cycle", () => {
      const employees = [emp(A, "Ada", C), emp(B, "Bo", null), emp(C, "Cy", null)];
      expect(reportingCycleError({ employees, userId: B, reportsTo: C })).toBeNull();
    });

    it("accepts re-parenting someone who currently sits above the new manager's peer", () => {
      // D reports to C; moving A (who has reports of their own) under D is fine.
      const employees = [emp(A, "Ada", null), emp(B, "Bo", A), emp(C, "Cy", null), emp(D, "Dee", C)];
      expect(reportingCycleError({ employees, userId: A, reportsTo: D })).toBeNull();
    });

    it("does not follow the edited row's own stale reports_to", () => {
      // A currently reports to B. Moving A under C must not be judged against
      // A's old pointer — the walk stops the moment it reaches A.
      const employees = [emp(A, "Ada", B), emp(B, "Bo", null), emp(C, "Cy", null)];
      expect(reportingCycleError({ employees, userId: A, reportsTo: C })).toBeNull();
    });

    it("accepts a manager who is not in the loaded directory — the walk just ends", () => {
      // Incomplete input must not invent a cycle; 037 is the real gate.
      const employees = [emp(A, "Ada", null)];
      expect(reportingCycleError({ employees, userId: A, reportsTo: "someone-else" })).toBeNull();
    });
  });

  describe("bounded walk", () => {
    it("terminates on data that already contains a cycle instead of looping forever", () => {
      // B -> C -> B is already stored (037 was applied after the fact, or the
      // row was written before it). Editing A must return, not hang.
      const employees = [emp(A, "Ada", null), emp(B, "Bo", C), emp(C, "Cy", B)];
      const message = reportingCycleError({ employees, userId: A, reportsTo: B });
      expect(message).toBeTruthy();
      expect(message).toContain("loop");
    });

    it("refuses a chain deeper than the bound rather than walking it", () => {
      const employees = [];
      const depth = MAX_REPORTING_DEPTH + 10;
      for (let i = 1; i <= depth; i += 1) {
        employees.push(emp(`e${i}`, `Emp ${i}`, i < depth ? `e${i + 1}` : null));
      }
      employees.push(emp(A, "Ada", null));
      const message = reportingCycleError({ employees, userId: A, reportsTo: "e1" });
      expect(message).toContain(String(MAX_REPORTING_DEPTH));
    });

    it("accepts a chain exactly at the bound", () => {
      const employees = [];
      for (let i = 1; i <= MAX_REPORTING_DEPTH; i += 1) {
        employees.push(emp(`e${i}`, `Emp ${i}`, i < MAX_REPORTING_DEPTH ? `e${i + 1}` : null));
      }
      employees.push(emp(A, "Ada", null));
      expect(reportingCycleError({ employees, userId: A, reportsTo: "e1" })).toBeNull();
    });
  });

  describe("degenerate input", () => {
    it("returns null when there is no employee to check", () => {
      expect(reportingCycleError({ employees: [], userId: null, reportsTo: B })).toBeNull();
    });

    it("tolerates a missing or non-array employees list", () => {
      expect(reportingCycleError({ userId: A, reportsTo: B })).toBeNull();
      expect(reportingCycleError({ employees: null, userId: A, reportsTo: B })).toBeNull();
      expect(reportingCycleError({ employees: "nope", userId: A, reportsTo: B })).toBeNull();
    });

    it("falls back to email, then to the raw id, when a name is missing", () => {
      const employees = [
        { userId: A, email: "ada@x.io", reportsTo: B },
        { userId: B, reportsTo: null },
      ];
      const message = reportingCycleError({ employees, userId: B, reportsTo: A });
      expect(message).toContain("ada@x.io");
      expect(message).toContain(B);
    });
  });
});
