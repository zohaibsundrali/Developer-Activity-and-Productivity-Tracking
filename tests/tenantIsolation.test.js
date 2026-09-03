import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Every service-role lookup that resolves a person or a row by an id the caller
 * supplied must check the row belongs to the caller's organization.
 *
 * THE BUG THAT PROMPTED THIS. /api/developer/delete has two handlers. DELETE
 * checked `developer.organization_id !== auth.orgId`. GET — the preview that
 * tells you what deleting will destroy — did not. It authenticated, it required
 * owner or admin, and then it resolved the developer with the SERVICE ROLE,
 * which bypasses RLS entirely. So an owner of any tenant could pass another
 * tenant's developer id or email and get back their name, their email, and how
 * many projects, tasks and submissions they hold.
 *
 * Every gate above the leak passed, because the caller really was an owner. Of
 * a different company. That is the shape of every cross-tenant bug in a product
 * whose routes hold the service key: authorization asks "may you do this", and
 * the missing question is "to whom".
 *
 * Found by a route-by-route audit, not by a test, and not by RLS — the service
 * role is precisely the thing RLS does not apply to.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the developer delete route", () => {
  const SRC = stripComments(read("src/app/api/developer/delete/route.js"));

  it("checks the organization in BOTH handlers, not just the destructive one", () => {
    const checks = SRC.match(/developer\.organization_id !== auth\.orgId/g) || [];
    expect(checks.length, "GET and DELETE must each carry the check").toBe(2);
  });

  it("puts the check before it reads anything about the person", () => {
    // A check that runs after the counts have been gathered still leaks them
    // if anything is logged or returned early.
    const get = SRC.slice(SRC.indexOf("export async function GET"));
    const guard = get.indexOf("organization_id !== auth.orgId");
    const counts = get.indexOf("const devId = developer.id");
    expect(guard).toBeGreaterThan(-1);
    expect(counts).toBeGreaterThan(guard);
  });

  it("answers the same 404 for another tenant's developer as for nobody", () => {
    // "Exists, but not yours" is most of the disclosure. Both branches must
    // return the identical body.
    // Sliced RELATIVE to the GET handler. Searching the whole file for the
    // end marker finds whichever handler happens to be first, which silently
    // produced an empty slice and an assertion that measured nothing.
    const start = SRC.indexOf("export async function GET");
    const get = SRC.slice(start, start + SRC.slice(start).indexOf("const devId = developer.id"));
    expect(get.length, "empty slice — the markers have moved").toBeGreaterThan(200);
    const notFound = get.match(/error: 'Developer not found\.'/g) || [];
    expect(notFound.length).toBe(2);
  });
});

describe("every route that uses the service role", () => {
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name === "route.js" || name === "route.ts") out.push(full);
    }
    return out;
  }
  const ROUTES = walk(path.join(root, "src/app/api"));

  it("is a set we are counting, so a new one cannot arrive unnoticed", () => {
    /**
     * NOT A PASS/FAIL RULE — a tripwire.
     *
     * The service role bypasses RLS, so each of these routes is responsible for
     * its own tenant scoping and there is no backstop if it forgets. There are
     * too many to gate mechanically here, and a test that pretended to check
     * them all would be worse than one that admits what it does.
     *
     * What this does is fail when the count changes, so adding a service-role
     * route is a deliberate act that someone has to look at rather than a line
     * that slides through review. If you are here because this failed: confirm
     * your new route scopes every query by organization_id, then update the
     * number.
     */
    const usingService = ROUTES.filter((f) =>
      /serviceClient\(|SUPABASE_SERVICE_ROLE_KEY/.test(stripComments(readFileSync(f, "utf8")))
    );
    // 57 -> 58: /api/admin/permissions, added with the overrides screen. It
    // reads memberships and user_permissions with the service role, and its
    // POST re-reads the target membership to confirm
    // `organization_id === auth.orgId` before writing — the check whose absence
    // let the developer-delete preview read across tenants.
    //
    // 58 -> 59: /api/projects/[id]/members. It resolves the project with
    // `.eq("organization_id", auth.orgId)` before anything else, and answers
    // 404 rather than 403 when that misses, so the route cannot confirm that a
    // project id exists in another tenant.
    //
    // 59 -> 61: /api/attendance and /api/leave, added with the attendance and
    // leave module (migration 075). Both take `organization_id` from
    // `auth.orgId` on every read and every write, never from the body; both
    // re-read the target row scoped to that org before updating it; and
    // /api/attendance re-reads the membership before writing somebody else's
    // day, so an HR lead cannot file a record against a uuid from another
    // tenant.
    //
    // 61 -> 62: /api/timesheets, added with timesheet approval (077). Every
    // read and write is scoped by `auth.orgId`, the week's totals are summed
    // from task_time_logs by the route rather than accepted from the body, and
    // the target timesheet is re-read scoped to the org before it is decided.
    //
    // 62 -> 63: /api/invoicing, added with invoicing and P&L (079). Every read
    // is `.eq("organization_id", auth.orgId)`, the project is re-read scoped to
    // the org before anything hangs off it, and the hours and rates on each
    // line are read back from billable_hours_v rather than taken from the body.
    //
    // 63 -> 64: /api/quality, added with the QA module (081). Every read and
    // write is `.eq("organization_id", auth.orgId)`; a run is re-read scoped to
    // the org before its executions are listed, so a run id from another tenant
    // answers 404 rather than leaking its shape; and a run's scope is read from
    // test_cases rather than taken from the body.
    //
    // 64 -> 65: /api/performance, added with review cycles (083). Every read
    // and write is `.eq("organization_id", auth.orgId)`; the cycle and the
    // review are re-read scoped to the org before either is changed; and the
    // reviewer is always `auth.appUserId`, never a value from the body.
    //
    // 65 -> 66: /api/recruitment, added with the ATS (085). Every read and
    // write is `.eq("organization_id", auth.orgId)`; the opening is re-read
    // scoped to the org before its candidates are listed, so an opening id from
    // another tenant answers 404; and the hiring-manager exemption is checked
    // against that same re-read row rather than against anything in the body.
    expect(usingService.length).toBe(66);
  });
});
