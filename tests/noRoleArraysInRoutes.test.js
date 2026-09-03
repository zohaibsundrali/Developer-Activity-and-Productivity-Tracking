import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { defaultRolesFor, PERMISSION_KEYS } from "@/utils/permissionCatalogue";

/**
 * NO API ROUTE DECIDES AUTHORIZATION FROM A HAND-TYPED ROLE LIST.
 *
 * THE FAULT, one more time. `serverPermissions.js` was written because fifteen
 * hand-typed role arrays were living inside individual route files — each
 * correct on the day it was written, each invisible to the others, so `qa` and
 * `finance` were added to the product twice and to those arrays never.
 *
 * #74 replaced the ones it found. This file went looking for the rest, and
 * found three:
 *
 *   /api/signals                     SIGNAL_ROLES, the same five roles
 *                                    `signal.view` already grants
 *   /api/change-requests/[id]/advance  STAFF_DECIDERS, the same three
 *                                    `change_request.decide` already grants
 *   /api/billing/access              ["owner","admin","finance"] for `canPay`
 *
 * The change-requests route kept ONE array after the fix, and deliberately: the
 * `admin_approve` step is owner/admin, narrower than the decider set, so that
 * the manager who priced the work is not also the one who agrees to sell it at
 * that price. A key cannot express "narrower than the key", which is the same
 * reason the closure route keeps one.
 *
 * The third was not a tidy-up. `canPay` told an admin or a finance lead they
 * could pay and sent them to /admin/upgrade — where checkout and cancel both
 * require `billing.purchase`, which is OWNER ONLY. They were promised a path
 * that 403s at the end of it, which is precisely the dead end that field's own
 * comment says it exists to prevent.
 *
 * A ROLE ARRAY CANNOT HONOUR AN OVERRIDE, which is the deeper reason. `authCan`
 * consults the per-person grants and denies that travel on `auth`;
 * `["owner","admin"].includes(auth.role)` cannot, so an explicit DENY written
 * against one individual is silently ignored wherever one of these survives.
 */

const root = path.resolve(__dirname, "..");
const API = path.join(root, "src/app/api");

function routeFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.js") out.push(full);
  }
  return out;
}

const ROUTES = routeFiles(API);
/** Comments stripped — this suite has twice asserted a comment, not the code. */
const read = (f) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const rel = (f) => path.relative(root, f);

/**
 * An array literal of role names, which is the shape being banned.
 *
 * A FUNCTION, NOT A SHARED REGEX. The first version was a module-level `/…/g`
 * called with `.test()` in a filter — and a `g` regex carries `lastIndex`
 * between calls, so every second file was skipped and the run reported the
 * wrong set twice over. A fresh regex per call has no state to carry.
 */
const hasRoleArray = (src) =>
  /\[\s*"(?:owner|admin|manager|hr|finance|team_lead|qa|developer|designer|devops|employee)"[^\]]*\]/.test(
    src
  );

/**
 * The uses that are NOT authorization, each with the reason.
 *
 * A file is allowed in here only when its array answers a different question
 * from "may this caller do this". The `it.each` below re-checks every entry, so
 * one that stops being true fails rather than sitting as cover for the next.
 */
const NOT_AUTHORIZATION = {
  "src/app/api/projects/[id]/closure/route.js":
    "narrows an already-granted key rather than replacing it — `project.complete` " +
    "says the role may complete projects at all, and the owner/admin line plus the " +
    "manager_id comparison say WHICH ones. The file argues this at length.",
  "src/app/api/projects/[id]/manager/route.js":
    "ELIGIBLE_MANAGER_ROLES is who may BE a project manager, not who may assign " +
    "one — the assigning is gated on project.assign_manager above it",
  "src/app/api/proposals/[id]/decide/route.js":
    "checks the role of the person being ASSIGNED as manager, not the caller's",
  "src/app/api/cron/route.js":
    "TRIAL_NOTIFY_ROLES is who receives a trial-expiry notification — a mailing " +
    "list, not a gate",
  "src/app/api/change-requests/[id]/advance/route.js":
    "the STAFF_DECIDERS guard now asks change_request.decide; the owner/admin " +
    "line that remains is the `admin_approve` step, NARROWER than the decider " +
    "set on purpose — a manager who priced the work should not also be the one " +
    "who agrees to sell it at that price. Same shape as the closure route: a " +
    "key first, then a narrowing the key cannot express.",
};

describe("no route decides authorization from a hand-typed role list", () => {
  it("finds the routes at all", () => {
    // A test that stops matching is a test that stops testing.
    expect(ROUTES.length).toBeGreaterThan(50);
  });

  it("every route with a role array is either fixed or recorded", () => {
    const offenders = ROUTES.filter((f) => hasRoleArray(read(f))).map(rel);
    expect(offenders.sort()).toEqual(Object.keys(NOT_AUTHORIZATION).sort());
  });

  it.each(Object.keys(NOT_AUTHORIZATION))("%s still needs its exemption", (file) => {
    // A stale exemption is how the next hand-typed gate gets waved through.
    expect(hasRoleArray(read(path.join(root, file)))).toBe(true);
  });
});

describe("the three that were replaced ask the key that already said it", () => {
  it("signals asks signal.view", () => {
    const src = read(path.join(root, "src/app/api/signals/route.js"));
    expect(src).toMatch(/authCan\(auth, "signal\.view"\)/);
    expect(src).not.toMatch(/SIGNAL_ROLES/);
    // and the key grants exactly what the array did
    expect([...defaultRolesFor("signal.view")].sort()).toEqual(
      ["owner", "admin", "hr", "manager", "team_lead"].sort()
    );
  });

  it("change-requests asks change_request.decide, and reads the list from the catalogue", () => {
    const src = read(path.join(root, "src/app/api/change-requests/[id]/advance/route.js"));
    expect(src).toMatch(/authCan\(auth, "change_request\.decide"\)/);
    expect(src).toMatch(/defaultRolesFor\("change_request\.decide"\)/);
    expect([...defaultRolesFor("change_request.decide")].sort()).toEqual(
      ["owner", "admin", "manager"].sort()
    );
  });

  it("billing/access promises only what checkout will honour", () => {
    // THE BUG. canPay said owner/admin/finance; checkout and cancel both
    // require `billing.purchase`, which is owner only. Admin and finance were
    // sent to a payment screen that refuses them.
    const access = read(path.join(root, "src/app/api/billing/access/route.js"));
    expect(access).toMatch(/canPay: authCan\(auth, "billing\.purchase"\)/);

    for (const route of ["checkout", "cancel"]) {
      const src = read(path.join(root, `src/app/api/billing/${route}/route.js`));
      expect(src, route).toMatch(/requirePermission\(auth, "billing\.purchase"\)/);
    }

    // The promise and the enforcement are now the same key, so they cannot
    // drift into a dead end again.
    expect(defaultRolesFor("billing.purchase")).toEqual(["owner"]);
  });
});

describe("every key a route asks for is a key that exists", () => {
  /**
   * `requirePermission` answers 500 for an unknown key rather than granting —
   * a route asking for a permission that does not exist is a bug in the route,
   * and answering "allowed" would be the worst reading of it. That is the right
   * runtime behaviour and a poor way to find out. This finds out here.
   */
  it("asks for no permission the catalogue does not define", () => {
    const asked = new Set();
    for (const f of ROUTES) {
      const src = read(f);
      for (const m of src.matchAll(/(?:authCan|requirePermission)\(\s*auth\s*,\s*["']([^"']+)["']/g)) {
        asked.add(m[1]);
      }
    }
    expect(asked.size).toBeGreaterThan(20);
    const unknown = [...asked].filter((k) => !PERMISSION_KEYS.includes(k));
    expect(unknown, "routes asking for keys the catalogue does not define").toEqual([]);
  });
});
