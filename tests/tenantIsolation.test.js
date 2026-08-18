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
    expect(usingService.length).toBe(57);
  });
});
