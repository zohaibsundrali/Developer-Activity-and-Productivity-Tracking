import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * THE SQL MISTAKES THIS PROJECT HAS ACTUALLY MADE, checked mechanically.
 *
 * Two defects reached `main` in this series and neither could have been caught
 * by any test that exercised the application, because the application was
 * behaving correctly in both cases:
 *
 *   079  `42803: subquery uses ungrouped column`. Only a real run finds it.
 *        Reported by the person running the migration, not by CI.
 *
 *   079  a plain LEFT JOIN to `employee_profiles`, which is unique on
 *        (organization_id, user_id, USER_TYPE) — so somebody promoted from
 *        developer to admin holds TWO rows and every sum in the view doubled.
 *        Found by reading, while checking the other view for the first bug.
 *
 *   082  six views created without `security_invoker`, so each read its base
 *        tables as the OWNER and skipped every RLS policy underneath. Passed
 *        2,400 tests, `build` and `lint`.
 *
 * WHAT THIS FILE CAN AND CANNOT DO. It cannot run Postgres — nobody here can;
 * `execute_sql` is not available on this account. So it does not pretend to
 * validate SQL. It checks the specific, mechanical properties whose absence
 * caused real damage, plus the one that makes a failed migration recoverable:
 * being safe to run twice.
 *
 * Everything here is precise rather than clever. A migration check with false
 * positives gets suppressed, and a suppressed check is worse than none.
 */

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "database");

const FILES = readdirSync(dir)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort();

/** Comments gone. Strings KEPT — a `drop` inside `execute format('…')` is a drop. */
const withStrings = (f) =>
  readFileSync(path.join(dir, f), "utf8").replace(/^\s*--.*$/gm, "");

/** Comments and string literals gone — for counting structure, not content. */
const structure = (f) =>
  withStrings(f).replace(/'(?:[^']|'')*'/g, "''");

describe("every migration is safe to run twice", () => {
  it("has migrations to check", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  /**
   * WHY THIS MATTERS MORE THAN IT LOOKS. 079 failed partway on its first real
   * run: everything before the broken view had already applied. The only reason
   * the fix was a one-line instruction — "re-run the whole file" — rather than
   * a hand-written repair script is that every statement in it was idempotent.
   */
  it.each(FILES)("%s creates nothing it cannot re-create", (file) => {
    const s = structure(file);

    const bareTable = s.match(/create\s+table\s+(?!if\s+not\s+exists)/gi) || [];
    expect(bareTable, `${file}: CREATE TABLE without IF NOT EXISTS`).toEqual([]);

    const bareIndex =
      s.match(/create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists|concurrently)/gi) || [];
    expect(bareIndex, `${file}: CREATE INDEX without IF NOT EXISTS`).toEqual([]);

    // `create view … with (…)` fails on the second run; `or replace` does not.
    const bareView = s.match(/create\s+view\s/gi) || [];
    expect(bareView, `${file}: CREATE VIEW without OR REPLACE`).toEqual([]);
  });

  it.each(FILES)("%s drops each trigger and policy before creating it", (file) => {
    // Strings kept on purpose: 013 and 016 drop theirs inside
    // `execute format('drop policy if exists …')` in a DO loop, which is
    // perfectly idempotent. Stripping strings first reported all three as
    // faults — the check was wrong, not the migrations.
    const s = withStrings(file);
    for (const kind of ["trigger", "policy"]) {
      const created = [...s.matchAll(new RegExp(`create\\s+${kind}\\s+(\\w+)`, "gi"))].map(
        (m) => m[1]
      );
      for (const name of created) {
        const dropped = new RegExp(`drop\\s+${kind}\\s+if\\s+exists\\s+${name}\\b`, "i").test(s);
        expect(dropped, `${file}: ${kind} "${name}" is created without being dropped first`).toBe(
          true
        );
      }
    }
  });
});

describe("the two SQL faults this series actually shipped", () => {
  /**
   * A partial index predicate must be IMMUTABLE and may not contain a subquery.
   * 079 was first written with exactly that — a unique index over
   * (organization_id, project_id, user_id, week_start) restricted to live
   * invoices — and Postgres will not have it. It became a trigger, and the
   * migration says so at length so the next reader does not "fix" it back.
   */
  it.each(FILES)("%s puts no subquery in an index predicate", (file) => {
    const s = structure(file);
    const offenders =
      s.match(/create\s+(?:unique\s+)?index[\s\S]{0,400}?\bwhere\b[\s\S]{0,300}?\(\s*select\b/gi) ||
      [];
    expect(offenders, `${file}: index predicate contains a subquery`).toEqual([]);
  });

  /**
   * `employee_profiles` is unique on (organization_id, user_id, USER_TYPE), so
   * one person legitimately holds two rows once they move between the admin and
   * developer profile tables — a developer promoted to admin is exactly that.
   *
   * A plain join therefore multiplies every row it touches. 079 shipped that
   * against this table and doubled `total_hours`, `costed_hours` and `cost` on
   * the screen that decides whether a project made money. 088 reads the same
   * table and uses a LATERAL with a LIMIT for this reason.
   *
   * Not a missing number — a confidently wrong one, which is the kind nobody
   * goes looking for.
   */
  it.each(FILES)("%s joins employee_profiles only through a lateral", (file) => {
    const s = structure(file);
    const joins = [...s.matchAll(/(\w+\s+)?join\s+public\.employee_profiles\b/gi)];
    for (const m of joins) {
      const preceding = s.slice(Math.max(0, m.index - 40), m.index + m[0].length);
      expect(
        /lateral/i.test(preceding),
        `${file}: plain join to employee_profiles — it is unique on (org, user_id, USER_TYPE), ` +
          `so this multiplies rows for anybody holding two profiles. Use LATERAL … LIMIT 1.`
      ).toBe(true);
    }
  });
});

/**
 * WHAT IS DELIBERATELY NOT CHECKED HERE, and why.
 *
 * A first draft of this file also counted parentheses and `$$` pairs per
 * migration. Both are cheap, and both are the "clever" kind of check this
 * file's header warns against — and on their very first run one of them failed
 * on 054, a migration that has been applied to production for months.
 *
 * The file was fine: 108 open, 108 close. The CHECK was wrong. It stripped only
 * whole-line `--` comments, so an apostrophe inside a TRAILING comment
 * ("my report's file") began a string literal as far as the next regex was
 * concerned, which then swallowed several lines and the parentheses in them.
 *
 * Fixing that means either a real SQL lexer or a `--`-to-end-of-line strip that
 * would itself corrupt any `--` inside a string. Neither is worth it, because
 * balanced parentheses would not have caught either defect this series actually
 * shipped. A migration check that cries wolf gets suppressed, and a suppressed
 * check is worse than no check at all.
 *
 * The checks kept above are the ones that map to real damage: idempotency,
 * because 079 failed halfway and re-running the file was the whole recovery
 * plan; the index predicate, because Postgres rejects it outright; and the
 * employee_profiles lateral, because a plain join there silently doubled money.
 */

describe("the migrations added in this series stay additive", () => {
  /**
   * 074 onwards is the work of this series. The user's standing instruction was
   * that nothing destructive runs without being told, and every one of these
   * was written to be additive — this is the check that keeps it true rather
   * than a promise in twenty separate file headers.
   *
   * `drop policy if exists` and `drop trigger if exists` are how a rule is
   * REPLACED and are expected; dropping a table or deleting rows is not.
   */
  const SERIES = FILES.filter((f) => Number(f.slice(0, 3)) >= 74);

  it("covers the migrations this series added", () => {
    expect(SERIES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(SERIES)("%s drops no table and deletes no rows", (file) => {
    const s = structure(file);
    expect(s, `${file}: DROP TABLE`).not.toMatch(/drop\s+table/i);
    expect(s, `${file}: TRUNCATE`).not.toMatch(/\btruncate\b/i);
    expect(s, `${file}: DELETE FROM`).not.toMatch(/delete\s+from/i);
    expect(s, `${file}: DROP COLUMN`).not.toMatch(/drop\s+column/i);
  });
});
