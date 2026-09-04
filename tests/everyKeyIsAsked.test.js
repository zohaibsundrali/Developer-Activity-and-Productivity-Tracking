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
 * THE CONSEQUENCE THIS FILE WAS WRITTEN TO RECORD, AND WHAT CLOSED IT.
 * `user_permissions` (migration 069) lets an organization grant or DENY a
 * permission to one named person, and `authCan` honours it. A rule enforced by
 * an RLS role list did not: `public.auth_role() in ('owner','admin','hr')`
 * cannot see an override, so writing an explicit DENY against an individual had
 * NO EFFECT for every key in ENFORCED_BY_RLS. Not a hole — the role rule still
 * held — but a promise the Permissions screen appeared to make and did not
 * keep.
 *
 * MIGRATION 094 CLOSED IT for the ten keys listed here, by adding
 * `public.auth_override(key)` and folding it into each policy. 095 does the
 * same for the quality module. The list below therefore no longer means "an
 * override does nothing here"; it means "no route asks this key, so the policy
 * is the only thing deciding it" — which is still worth one place saying,
 * because it is where you look when a change to a route mysteriously changes
 * nothing.
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
  it("names them, because the policy is the only thing deciding them", () => {
    // No route asks these keys, so `memberships_update` and friends are the
    // whole gate. 094 taught those policies to consult `auth_override`, so a
    // per-person exception now applies here too — but a change to a ROUTE still
    // does nothing for any of them, which is what this list is for.
    expect(Object.keys(ENFORCED_BY_RLS).length).toBeGreaterThan(0);
    for (const key of Object.keys(ENFORCED_BY_RLS)) {
      expect(PERMISSIONS.map((p) => p.key), key).toContain(key);
    }
  });

  it("does not let that list quietly grow", () => {
    // NINE. It was ten until `hierarchy.manage` got the ReportingLines panel,
    // which asks it — the good outcome this file is built to force: the entry
    // failed, and was deleted rather than updated.
    //
    // Every addition is a capability no route decides, so it should be a
    // decision somebody makes on purpose.
    expect(Object.keys(ENFORCED_BY_RLS).length).toBe(9);
  });
});
