import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PERMISSIONS } from "@/utils/permissionCatalogue";

/**
 * EVERY PERMISSION KEY IS EITHER ASKED, OR RECORDED AS NOT ASKED AND WHY.
 *
 * WHAT THIS FOUND. Sweeping the catalogue for keys nothing in `src/` asks for
 * turned up 18 of 102. Three of them were the old fault still standing — a
 * route deciding authorization from a hand-typed role array while a key already
 * named the same set — and those were replaced (see
 * tests/noRoleArraysInRoutes.test.js). The rest fall into three honest
 * categories, and none of them is an open door:
 *
 *   COVERED_BY_SCREEN   the capability has a surface under another key's roof.
 *                       tests/ownKeysHaveScreens.test.js checks each one.
 *
 *   ENFORCED_BY_RLS     the action happens in a component writing straight to
 *                       PostgREST, so the row-level policy IS the gate. The key
 *                       writes the same rule down; nothing reads it.
 *
 *   NO_FEATURE_YET      the product has no way to do this at all. The key
 *                       describes an intention.
 *
 * THE CONSEQUENCE, WHICH IS THE REASON THIS FILE EXISTS. `user_permissions`
 * (migration 069) lets an organization grant or DENY a permission to one named
 * person, and `authCan` honours it. A rule enforced by an RLS role list does
 * not: `public.auth_role() in ('owner','admin','hr')` cannot see an override.
 *
 * So for every key in ENFORCED_BY_RLS below, writing an explicit DENY against
 * an individual has NO EFFECT. That is not a hole — the role rule still holds —
 * but it is a promise the Permissions screen appears to make and does not keep,
 * and it is worth one place saying so rather than fourteen places not.
 *
 * WHAT THIS FILE IS FOR. The list can shrink. It must not grow silently: a new
 * key with no caller fails here and has to be argued for.
 */

const root = path.resolve(__dirname, "..");

function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.(jsx?|ts)$/.test(e.name) && !full.endsWith("permissionCatalogue.js")) out.push(full);
  }
  return out;
}

/** Everything in src/ except the catalogue itself, concatenated once. */
const HAYSTACK = sourceFiles(path.join(root, "src"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** A key counts as asked under its own name OR its legacy `can()` name. */
const isAsked = (p) =>
  [p.key, p.legacy]
    .filter(Boolean)
    .some((n) => HAYSTACK.includes(`'${n}'`) || HAYSTACK.includes(`"${n}"`));

const COVERED_BY_SCREEN = {
  "timesheet.log_own": "My Timesheet — logging hours is what the screen is for",
  "team.view_own": "My Activity — the panel listing who else is on your projects",
  "profile.manage_own": "Account, which predates the *_own family entirely",
  "monitoring.view_own": "My Activity — the recorded-activity panel",
};

const ENFORCED_BY_RLS = {
  "organization.manage": "OrganizationManagement writes org rows directly; org_self in 013 is the gate",
  "member.manage": "memberships_update in 018 — owner/admin/hr",
  "member.create": "CreateClientAccount inserts a membership directly; 018's insert policy is the gate",
  "employee.onboard": "employee_profiles_write in 018 — owner/admin/hr",
  "employee.transfer": "the same policy; a transfer is an update to the profile row",
  "employee.activate": "EmployeeProfileEditor writes employment_status directly, under the same policy",
  "hierarchy.manage": "reports_to is written on memberships, under memberships_update in 018",
  "team.view": "TeamPanel reads memberships and project_members, both org-readable by RLS",
  "project.create": "projects are inserted straight from the browser under 013's org policy",
  "billing.manage": "BillingSubscription reads through /api/billing/subscription, which asks billing.view; there is no separate 'manage' action in the UI",
};

const NO_FEATURE_YET = {
  "organization.delete":
    "the only delete of an organization is signup's own rollback of a failed " +
    "signup, with the service role. There is no way for anybody to delete their " +
    "organization from the product.",
  "project.delete": "nothing in src/ deletes a project; the screens archive and close instead",
  "project.close": "closure runs through /api/projects/[id]/closure, which asks project.complete",
  "task.submit": "submission goes through /api/task-submission, which asks task.update_own",
};

const RECORDED = { ...COVERED_BY_SCREEN, ...ENFORCED_BY_RLS, ...NO_FEATURE_YET };

describe("every permission key is asked, or recorded as not asked", () => {
  it("has a catalogue to check", () => {
    expect(PERMISSIONS.length).toBeGreaterThan(90);
  });

  it("finds no unasked key that has not been argued for", () => {
    const unasked = PERMISSIONS.filter((p) => !isAsked(p)).map((p) => p.key);
    expect(unasked.sort()).toEqual(Object.keys(RECORDED).sort());
  });

  it.each(Object.keys(RECORDED))("%s is still unasked, so its entry still earns its place", (key) => {
    // A stale entry is cover for the next one. If somebody wires this key up,
    // this fails and the entry gets deleted — which is the good outcome.
    const p = PERMISSIONS.find((x) => x.key === key);
    expect(p, `${key} is no longer in the catalogue`).toBeTruthy();
    expect(isAsked(p), `${key} is asked now — delete its entry from this file`).toBe(false);
  });

  it("gives every recorded key a real reason, not a shrug", () => {
    for (const [key, why] of Object.entries(RECORDED)) {
      expect(why.length, `${key} needs an actual reason`).toBeGreaterThan(30);
    }
  });
});

describe("what the RLS-enforced keys cost, stated once", () => {
  it("names them, because an override against one person does nothing there", () => {
    // `user_permissions` (069) lets an organization DENY a permission to a named
    // individual, and `authCan` honours it. `public.auth_role() in (…)` cannot.
    // Anybody wondering why a deny "did not work" should find this list.
    expect(Object.keys(ENFORCED_BY_RLS).length).toBeGreaterThan(0);
    for (const key of Object.keys(ENFORCED_BY_RLS)) {
      expect(PERMISSIONS.map((p) => p.key), key).toContain(key);
    }
  });

  it("does not let that list quietly grow", () => {
    // Ten today. Every addition is a capability whose per-person override stops
    // working, so it should be a decision somebody makes on purpose.
    expect(Object.keys(ENFORCED_BY_RLS).length).toBe(10);
  });
});
