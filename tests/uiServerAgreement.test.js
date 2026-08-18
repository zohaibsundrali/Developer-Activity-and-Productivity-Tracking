import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLES, MANAGEABLE_BY_ROLES } from "@/utils/roles";
import { roleCan } from "@/utils/permissionEngine";
import { defaultRolesFor, isPermissionKey } from "@/utils/permissionCatalogue";

/**
 * The screen and the route agree about who may do a thing.
 *
 * THE ROUTES WERE THE EASY HALF. Eighteen of them now ask the catalogue, and no
 * hand-typed caller role array survives in any of them. The browser was still
 * deciding the same questions with its own copies:
 *
 *   ChangeRequests.jsx     canPrice   = ["owner","admin","manager"]
 *                          canApprove = ["owner","admin"]
 *   ProjectRequests.jsx    canDecide  = ["owner","admin","manager"]
 *   ProjectOverview.jsx    canAssignManager = hasRole("owner","admin")
 *                          eligible managers = ["owner","admin","manager","team_lead"]
 *   TaskDetailDrawer.jsx   canSetClientVisibility = hasRole("owner","admin","manager")
 *
 * Every one of those matched its server counterpart on the day it was written,
 * and nothing made them keep matching. That is precisely how the six drifts
 * this phase started from happened — including the invite dropdown that offered
 * three roles the API refused.
 *
 * A mismatch here does not usually look like a security hole. It looks like a
 * button that does nothing: the UI offers an action, the user clicks it, the
 * route answers 403. HR's Delete button did exactly that for as long as the
 * product has existed.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) =>
  readFileSync(path.join(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * One capability, both sides. `roles` is written out rather than imported —
 * same reasoning as the parity fixture: it records the intended audience, and a
 * record that follows whatever the code currently says records nothing.
 */
const SHARED = [
  {
    what: "price a change request",
    key: "change_request.decide",
    roles: ["owner", "admin", "manager"],
    screen: "src/components/admin/ChangeRequests.jsx",
    route: "src/app/api/change-requests/[id]/advance/route.js",
  },
  {
    what: "approve a change request for sale",
    key: "change_request.approve",
    roles: ["owner", "admin"],
    screen: "src/components/admin/ChangeRequests.jsx",
    route: "src/app/api/change-requests/[id]/advance/route.js",
  },
  {
    what: "decide a client proposal",
    key: "proposal.decide",
    roles: ["owner", "admin", "manager"],
    screen: "src/components/admin/ProjectRequests.jsx",
    route: "src/app/api/proposals/[id]/decide/route.js",
  },
  {
    what: "assign a project manager",
    key: "project.assign_manager",
    roles: ["owner", "admin"],
    screen: "src/components/admin/ProjectOverview.jsx",
    route: "src/app/api/projects/[id]/manager/route.js",
  },
];

describe("the screen asks the same question as the route", () => {
  it.each(SHARED)("$what — the screen asks for $key", ({ key, screen }) => {
    expect(read(screen), `${screen} should call allowed("${key}")`).toContain(
      `allowed("${key}")`
    );
  });

  it.each(SHARED)("$what — $key admits exactly the intended roles", ({ key, roles }) => {
    expect(isPermissionKey(key)).toBe(true);
    for (const role of ROLES) {
      expect(roleCan(role, key), `${role} / ${key}`).toBe(roles.includes(role));
    }
  });

  it.each(SHARED)("$what — the screen keeps no role list of its own", ({ screen }) => {
    // The shape the old copies had: an array of quoted role names, or a
    // hasRole() call naming them.
    const src = read(screen);
    expect(src, `${screen} lists roles inline again`).not.toMatch(
      /\[\s*["']owner["']\s*,\s*["']admin["']/
    );
    expect(src, `${screen} calls hasRole with role literals again`).not.toMatch(
      /hasRole\(\s*["']owner["']/
    );
  });

  it("keeps the two-person rule on BOTH sides", () => {
    /**
     * The one that matters most. Pricing a change request and approving it for
     * sale are deliberately different sets, so whoever set the number is not
     * also the one who agrees to sell at it. If those two keys ever resolve to
     * the same roles the rule is gone — silently, on both sides at once,
     * because both now read the same catalogue.
     */
    const price = defaultRolesFor("change_request.decide");
    const approve = defaultRolesFor("change_request.approve");
    expect(price).toContain("manager");
    expect(approve).not.toContain("manager");
    expect([...approve].sort()).not.toEqual([...price].sort());
  });
});

describe("target lists have one definition too", () => {
  it("eligible project managers are named once, and both sides read it", () => {
    // NOT a permission — it says who may BE assigned, not who may assign. It
    // had two copies: ELIGIBLE_MANAGER_ROLES in the route and an inline filter
    // in ProjectOverview.
    expect([...MANAGEABLE_BY_ROLES]).toEqual(["owner", "admin", "manager", "team_lead"]);
    expect(read("src/components/admin/ProjectOverview.jsx")).toContain(
      "MANAGEABLE_BY_ROLES.includes(e.role)"
    );
    expect(read("src/app/api/projects/[id]/manager/route.js")).toMatch(
      /ELIGIBLE_MANAGER_ROLES|MANAGEABLE_BY_ROLES/
    );
  });

  it("is frozen, so a component cannot widen it at runtime", () => {
    expect(Object.isFrozen(MANAGEABLE_BY_ROLES)).toBe(true);
    expect(() => MANAGEABLE_BY_ROLES.push("developer")).toThrow();
  });

  it("names only real roles", () => {
    for (const role of MANAGEABLE_BY_ROLES) expect(ROLES).toContain(role);
  });
});

describe("notify queries are derived, not restated", () => {
  it("the proposal screen notifies whoever can open the queue", () => {
    // A query, not a gate — but a hand-typed one drifts exactly the same way,
    // and the symptom is worse: nobody is told, and nothing errors.
    expect(read("src/components/admin/ProjectRequests.jsx")).toContain(
      'defaultRolesFor("proposal.view")'
    );
  });

  it("the change-request route notifies whoever can raise one", () => {
    expect(read("src/app/api/change-requests/route.js")).toContain(
      'defaultRolesFor("change_request.create")'
    );
  });
});

describe("client visibility got its own key rather than borrowing one", () => {
  it("is asked for by the drawer", () => {
    expect(read("src/components/admin/TaskDetailDrawer.jsx")).toContain(
      'allowed("task.set_client_visibility")'
    );
  });

  it("is a key of its own, even though it matches client.notify today", () => {
    // The call site argued against borrowing a capability "whose membership is
    // free to drift for unrelated reasons". That argument is right, and it is
    // an argument for a dedicated key — not for a role list in a component.
    expect(isPermissionKey("task.set_client_visibility")).toBe(true);
    expect([...defaultRolesFor("task.set_client_visibility")]).toEqual([
      "owner", "admin", "manager",
    ]);
  });
});
