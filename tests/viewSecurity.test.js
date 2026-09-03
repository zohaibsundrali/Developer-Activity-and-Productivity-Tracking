import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * EVERY VIEW READS AS THE CALLER.
 *
 * THE DEFECT THIS EXISTS TO STOP HAPPENING AGAIN. Six views were added across
 * migrations 075, 079, 081, 083 and 085, and not one of them said
 * `security_invoker = true`.
 *
 * A Postgres view executes with the privileges of its OWNER unless told
 * otherwise. The migration runner owns these, and the owner is not subject to
 * row level security — so each view read its base tables with every policy
 * skipped. Supabase exposes views in `public` through PostgREST and grants
 * SELECT on new objects there to `anon` and `authenticated` by default, so the
 * browser's own anon-key client could have selected straight from them.
 *
 * `project_pnl_v` was the worst of it: per-project cost, which is hours times
 * `employee_profiles.cost_rate` — what people are paid. `pnl.view` was
 * deliberately withheld from `manager` for precisely that reason, and the view
 * handed it to everybody with a login.
 *
 * WHY NOTHING CAUGHT IT. The routes were correct: they use the service role,
 * which bypasses RLS anyway, and gate on a permission key first. So the
 * application behaved exactly as designed while the database was open
 * underneath it. Every existing test asserted the application's behaviour.
 *
 * This file asserts the property instead of the behaviour, which is the only
 * kind of test that would have caught it.
 */

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "database");

const SQL_FILES = readdirSync(dir)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort();

/** `create [or replace] view public.x` and whatever follows, to the `as`. */
const VIEW_RE = /create\s+(?:or\s+replace\s+)?view\s+(public\.\w+)([\s\S]{0,200}?)\bas\b/gi;

function viewsIn(file) {
  const src = readFileSync(path.join(dir, file), "utf8").replace(/^\s*--.*$/gm, "");
  return [...src.matchAll(VIEW_RE)].map((m) => ({
    name: m[1],
    preamble: m[2],
    file,
  }));
}

const ALL_VIEWS = SQL_FILES.flatMap(viewsIn);

describe("every view in every migration reads as the caller", () => {
  it("finds the views at all, so this file cannot pass by matching nothing", () => {
    // A regex that stops matching is a test that stops testing.
    //
    // The floor is three rather than six on purpose: this file has to pass on
    // `main`, where only 075's and 079's views exist, AND on a branch carrying
    // 081, 083 and 085. What actually matters is the `it.each` below, which
    // covers every view it finds — the floor only proves it found some.
    expect(ALL_VIEWS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(ALL_VIEWS.map((v) => [`${v.file} :: ${v.name}`, v]))(
    "%s declares security_invoker",
    (_label, view) => {
      expect(view.preamble).toMatch(/security_invoker\s*=\s*true/i);
    }
  );

  it("names every one of them in the corrective migration", () => {
    // 087 exists for the databases where these views were already created
    // without it. A view added later that is not listed there is fine — it is
    // correct from birth — but the six that were wrong must stay listed, or the
    // fix silently stops covering them.
    const fix = readFileSync(path.join(dir, "087_view_security_invoker.sql"), "utf8");
    for (const name of [
      "public.leave_balances_v",
      "public.billable_hours_v",
      "public.project_pnl_v",
      "public.test_run_summary_v",
      "public.review_cycle_summary_v",
      "public.job_opening_pipeline_v",
    ]) {
      expect(fix, name).toContain(`'${name}'`);
    }
  });

  it("keeps the corrective migration safe to run at any point", () => {
    const fix = readFileSync(path.join(dir, "087_view_security_invoker.sql"), "utf8");
    // Guarded on existence, so it can run before, between or after the
    // migrations that create the views, and again afterwards.
    expect(fix).toMatch(/to_regclass\(v\) is not null/);
    expect(fix).not.toMatch(/drop\s+view/i);
  });

  it("leaves every view re-runnable", () => {
    // `create view ... with (...)` fails the second time. These migrations are
    // re-run whenever one of them fails partway, so the OR REPLACE matters.
    for (const view of ALL_VIEWS) {
      const src = readFileSync(path.join(dir, view.file), "utf8");
      expect(src, `${view.file} :: ${view.name}`).toMatch(
        new RegExp(`create or replace view ${view.name.replace(".", "\\.")}`, "i")
      );
    }
  });
});
