import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLES } from "@/utils/roles";
import { roleCan } from "@/utils/permissionEngine";
import { isPermissionKey } from "@/utils/permissionCatalogue";

/**
 * Each converted route asks for the RIGHT permission, and the checks a
 * permission cannot express are still there.
 *
 * WHY THIS FILE EXISTS. Mutation testing swapped `billing.purchase` for
 * `billing.manage` in the three billing writes — handing admin and finance the
 * power to start and cancel the organization's subscription — and the whole
 * suite stayed green. It then deleted the ownership half of `mayManage`,
 * letting every manager in the org complete every project, and the suite stayed
 * green again.
 *
 * The parity suite pins what each KEY means. Nothing pinned which key each
 * ROUTE asks for, so the two most dangerous widenings in this change were
 * exactly the two nothing was watching. A permission system is only as good as
 * the weakest call site, and call sites are not covered by testing the
 * resolver.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) =>
  readFileSync(path.join(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * route file → the permission it must ask for, and who that admits.
 *
 * `roles` is duplicated from the catalogue ON PURPOSE, exactly as in the parity
 * fixture: it is a record of the intended audience, and a record that updates
 * itself when the thing it records changes is not a record. Widen the key and
 * this file fails.
 */
const GUARDS = [
  { file: "src/app/api/billing/checkout/route.js", key: "billing.purchase", roles: ["owner"] },
  { file: "src/app/api/billing/cancel/route.js", key: "billing.purchase", roles: ["owner"] },
  { file: "src/app/api/billing/portal/route.js", key: "billing.purchase", roles: ["owner"] },
  { file: "src/app/api/billing/subscription/route.js", key: "billing.view", roles: ["owner", "admin", "finance"] },
  { file: "src/app/api/billing/demo-activate/route.js", key: "billing.purchase", roles: ["owner"] },
  { file: "src/app/api/admin/health/route.js", key: "system.health", roles: ["owner", "admin"] },
  { file: "src/app/api/admin/legacy-auth-audit/route.js", key: "system.audit", roles: ["owner", "admin"] },
  { file: "src/app/api/admin/members/sync-roles/route.js", key: "member.sync_roles", roles: ["owner", "admin"] },
  { file: "src/app/api/admin-review/route.js", key: "task.review", roles: ["owner", "admin", "manager", "team_lead", "qa"] },
  { file: "src/app/api/task-plan/review/route.js", key: "task.review", roles: ["owner", "admin", "manager", "team_lead", "qa"] },
  { file: "src/app/api/notify/client/route.js", key: "client.notify", roles: ["owner", "admin", "manager"] },
  { file: "src/app/api/proposals/[id]/decide/route.js", key: "proposal.decide", roles: ["owner", "admin", "manager"] },
  { file: "src/app/api/projects/[id]/manager/route.js", key: "project.assign_manager", roles: ["owner", "admin"] },
  { file: "src/app/api/invitations/route.js", key: "member.invite", roles: ["owner", "admin", "hr", "manager"] },
  { file: "src/app/api/auth/provision/route.js", key: "member.provision", roles: ["owner", "admin", "hr", "manager"] },
  { file: "src/app/api/change-requests/route.js", key: "change_request.create", roles: ["owner", "admin", "manager"] },
  { file: "src/app/api/developer-gantt/route.js", key: "project.view_all", roles: ["owner", "admin", "manager", "team_lead"] },
  { file: "src/app/api/projects/[id]/closure/route.js", key: "project.complete", roles: ["owner", "admin", "manager", "team_lead"] },
];

describe("each converted route asks for the permission it is supposed to", () => {
  it.each(GUARDS)("$file -> $key", ({ file, key }) => {
    const src = read(file);
    const asked = new RegExp(
      `(?:requirePermission|authCan)\\(\\s*auth\\s*,\\s*["']${key.replace(".", "\\.")}["']`
    );
    expect(src, `${file} does not ask for ${key}`).toMatch(asked);
  });

  it.each(GUARDS)("$key admits exactly the intended roles", ({ key, roles }) => {
    expect(isPermissionKey(key)).toBe(true);
    for (const role of ROLES) {
      expect(roleCan(role, key), `${role} / ${key}`).toBe(roles.includes(role));
    }
  });

  it("never lets a billing WRITE fall back to the wider billing key", () => {
    // The exact mutation that survived: billing.purchase -> billing.manage.
    // Checkout, cancel and portal commit the organization to money. finance
    // and admin may READ billing and may not do this.
    for (const file of [
      "src/app/api/billing/checkout/route.js",
      "src/app/api/billing/cancel/route.js",
      "src/app/api/billing/portal/route.js",
      // ADDED AFTER THE AUDIT. demo-activate was listed above as
      // `billing.manage` — the exact swap this test was written to catch,
      // sitting in the table of expectations rather than in the code, so the
      // test asserted the bug. And it is the worst route to have it on: it
      // grants a paid plan without taking payment, so `billing.manage` let a
      // FINANCE user put the organization on Enterprise for nothing.
      "src/app/api/billing/demo-activate/route.js",
    ]) {
      expect(read(file), file).not.toMatch(/billing\.manage/);
      expect(read(file), file).not.toMatch(/billing\.view/);
    }
    expect(roleCan("admin", "billing.purchase")).toBe(false);
    expect(roleCan("finance", "billing.purchase")).toBe(false);
  });

  /**
   * The one role array that is allowed to remain, and why.
   *
   * ELIGIBLE_MANAGER_ROLES answers "who may BE assigned as a project manager".
   * That is a constraint on the TARGET of the operation, not on the caller, so
   * it is not a permission and folding it into the catalogue would conflate
   * "may do this" with "may have this done to them". The caller gate on that
   * same route is `project.assign_manager`, and it is asserted above.
   *
   * Listed explicitly rather than loosened out of the regex: an exception that
   * has to be named is one somebody has to justify.
   */
  const TARGET_LISTS = [
    { file: "src/app/api/projects/[id]/manager/route.js", name: "ELIGIBLE_MANAGER_ROLES" },
  ];

  it("keeps no hand-typed CALLER role array in any route", () => {
    // The claim the whole change rests on. If one comes back, it comes back
    // silently, exactly as the last five did.
    const exempt = new Map(TARGET_LISTS.map((t) => [t.file, t.name]));
    for (const { file } of GUARDS) {
      let src = read(file);
      const allowed = exempt.get(file);
      if (allowed) {
        // Strip only the named exemption, so any OTHER array in that same file
        // is still caught.
        src = src.replace(new RegExp(`const ${allowed} = \\[[^\\]]*\\];`), "");
      }
      expect(src, `${file} declares a caller role array again`).not.toMatch(
        /const\s+[A-Z_]+\s*=\s*\[\s*['"](?:owner|admin|manager|hr|finance|team_lead|qa)['"]/
      );
    }
  });

  it("keeps every exemption pointing at something that still exists", () => {
    // An exemption for a constant that has been deleted silently widens the
    // rule above to nothing.
    for (const { file, name } of TARGET_LISTS) {
      expect(read(file), `${name} is gone — drop the exemption`).toContain(`const ${name} = [`);
    }
  });
});

describe("the checks a permission cannot express are still there", () => {
  it("closure still requires the manager to own the project", () => {
    /**
     * THE MUTATION THAT SURVIVED. `mayManage` is role AND ownership: owner and
     * admin always; a manager or team lead only when the project's manager_id
     * is them, or when it is nobody. Deleting the second half let every manager
     * in the organization complete every project, and nothing failed.
     *
     * `project.complete` is the role half only, and it must stay that way until
     * something populates `subject.projectRoles` — nothing does yet.
     */
    const src = read("src/app/api/projects/[id]/closure/route.js");
    expect(src).toContain('authCan(auth, "project.complete")');
    expect(src).toMatch(/String\(project\.manager_id\) === String\(auth\.appUserId\)/);
    expect(src).toMatch(/if \(!project\.manager_id\) return true;/);
    // And the ownership comparison must come AFTER the owner/admin short
    // circuit, or owners would be blocked from projects they do not manage.
    const shortCircuit = src.indexOf('["owner", "admin"].includes(auth.role)');
    const ownership = src.indexOf("String(project.manager_id)");
    expect(shortCircuit).toBeGreaterThan(-1);
    expect(ownership).toBeGreaterThan(shortCircuit);
  });

  it("invitations and provision still refuse a grant at or above the caller", () => {
    // A capability check cannot express "not above your own rank" — it compares
    // two roles rather than asking about one. Both routes keep it.
    expect(read("src/app/api/invitations/route.js")).toMatch(/wantedRank\s*>=\s*callerRank/);
    expect(read("src/app/api/auth/provision/route.js")).toMatch(/requestedRank\s*>=\s*callerRank/);
  });

  it("the self-scoping branches survive, so contributors keep their own data", () => {
    // THIS ASSERTION USED TO REQUIRE THE OPPOSITE ORDER, AND THAT WAS THE BUG.
    //
    // It read: the self-scoping branch must come BEFORE the staff permission —
    // pinning `if (auth.userType === 'developer')` as the first test in the
    // route. The fear behind it was real ("losing that would 403 every
    // developer on the gantt chart") but the mechanism was wrong, because
    // userType is a storage column: userTypeForRole() files nine of the twelve
    // roles under "developer", so a manager and a team lead took the self-
    // scoping branch too and the `authCan(project.view_all)` below it was
    // unreachable for them. The test was green the whole time it was describing
    // the defect.
    //
    // What the fear actually needs is that a contributor still ends up on their
    // own id — which is now a permission (`project.view_own`) rather than a
    // consequence of which table their profile row sits in. So: both keys
    // present, the WIDE one asked first, and the narrow branch reading the
    // identity from the token.
    const gantt = read("src/app/api/developer-gantt/route.js");
    const wide = gantt.indexOf("project.view_all");
    const narrow = gantt.indexOf("project.view_own");
    expect(wide).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(wide);
    expect(gantt).toMatch(/developerId\s*=\s*auth\.appUserId/);
    // and the query string can no longer decide it for a caller without the
    // wide key — that is what `wantsSomeoneElse` gates
    expect(gantt).toMatch(/wantsSomeoneElse/);
  });

  it("change-requests keeps the client branch the staff permission would refuse", () => {
    // requirePermission 403s every client. This route is dual-audience — a
    // client raises change requests too — so the permission may only guard the
    // staff branch.
    const src = read("src/app/api/change-requests/route.js");
    expect(src).toMatch(/isClient/);
    expect(src).toMatch(/} else if \(!authCan\(auth, "change_request.create"\)\)/);
  });
});
