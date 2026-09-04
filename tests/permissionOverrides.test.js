import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { loadOverrides, OverridesUnavailableError } from "@/utils/permissionOverrides";
import { requirePermission, authCan } from "@/utils/serverPermissions";

/**
 * Per-person grants and denies: where they come from, and what happens when
 * they cannot be read.
 *
 * THE ONE THING THIS FILE EXISTS TO PROTECT. There are two ways the lookup can
 * fail to answer, and treating them the same is a security bug in one
 * direction:
 *
 *   TABLE ABSENT   the migration has not run, so no override CAN exist. "No
 *                  overrides" is the truth, not a guess. Fall through to the
 *                  role — which is exactly today's behaviour.
 *   QUERY FAILED   overrides may exist and we could not read them. Answering
 *                  "no overrides" would silently ignore every DENY in the
 *                  organization. A deny exists precisely to take access away
 *                  from somebody who would otherwise have it, so ignoring one
 *                  is fail-OPEN. Refuse instead.
 *
 * Get that backwards and nothing breaks, nothing logs, and the person you
 * revoked keeps their access.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** A stand-in for the PostgREST query chain, ending in the result. */
function fakeClient(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return { from: () => chain };
}

const AUTH = { orgId: "org-1", appUserId: "user-1", userType: "developer" };

describe("loadOverrides", () => {
  it("returns the grants and denies as a map", async () => {
    const svc = fakeClient({
      data: [
        { permission_key: "task.review", allowed: true },
        { permission_key: "billing.view", allowed: false },
      ],
      error: null,
    });
    expect(await loadOverrides(svc, AUTH)).toEqual({
      "task.review": true,
      "billing.view": false,
    });
  });

  it("treats a MISSING TABLE as no overrides, because none can exist", async () => {
    const svc = fakeClient({ data: null, error: { code: "PGRST205", message: "not found" } });
    await expect(loadOverrides(svc, AUTH)).resolves.toEqual({});
  });

  it("REFUSES to answer when the query fails for any other reason", async () => {
    // The whole point. Silently returning {} here would ignore every deny.
    for (const code of ["PGRST301", "57014", "08006", undefined]) {
      const svc = fakeClient({ data: null, error: { code, message: "boom" } });
      await expect(loadOverrides(svc, AUTH), String(code)).rejects.toBeInstanceOf(
        OverridesUnavailableError
      );
    }
  });

  it("returns nothing when it does not know who is asking", async () => {
    const svc = fakeClient({ data: [{ permission_key: "task.review", allowed: true }], error: null });
    for (const partial of [
      {},
      { orgId: "org-1" },
      { orgId: "org-1", appUserId: "u" },
      { appUserId: "u", userType: "developer" },
    ]) {
      expect(await loadOverrides(svc, partial), JSON.stringify(partial)).toEqual({});
    }
    expect(await loadOverrides(null, AUTH)).toEqual({});
  });

  it("ignores a row whose decision is not a yes or a no", async () => {
    // A null `allowed` means the row exists with the decision withdrawn. The
    // safe reading is to fall through to the role, not to guess a direction.
    const svc = fakeClient({
      data: [
        { permission_key: "task.review", allowed: null },
        { permission_key: "billing.view", allowed: false },
      ],
      error: null,
    });
    expect(await loadOverrides(svc, AUTH)).toEqual({ "billing.view": false });
  });

  it("scopes by organization AND user, not by user alone", () => {
    // The same person in two organizations is two memberships. An exception in
    // one must not follow them to the other. Asserted on the source because the
    // filter is what enforces it and a fake client cannot show a missing eq().
    const src = read("src/utils/permissionOverrides.js");
    expect(src).toContain('.eq("memberships.organization_id", auth.orgId)');
    expect(src).toContain('.eq("memberships.user_id", auth.appUserId)');
    expect(src).toContain('.eq("memberships.user_type", auth.userType)');
    expect(src).toContain("memberships!membership_id!inner");
  });

  it("names WHICH foreign key it embeds through, because there are two", () => {
    // user_permissions reaches memberships twice: membership_id (whose row) and
    // granted_by (who wrote it). An unhinted `memberships!inner` is ambiguous,
    // PostgREST answers PGRST201 instead of rows, loadOverrides throws, and
    // every permission-gated route in the product fails closed with a 503 —
    // for everyone, in every organization. That is what this pins.
    const src = read("src/utils/permissionOverrides.js");
    expect(src).not.toMatch(/memberships!inner\(/);
    expect(src).toMatch(/memberships!membership_id!inner\(organization_id, user_id, user_type\)/);
    // And the failure, should it ever come back, is no longer silent.
    const auth = read("src/utils/serverAuth.js");
    expect(auth).toMatch(/catch \(e\) \{[\s\S]*console\.error\([\s\S]*overridesUnavailable = true;/);
    expect(auth).not.toMatch(/catch \{\s*overridesUnavailable = true;/);
  });
});

describe("the guards honour an override", () => {
  const staff = (role, extra = {}) => ({ role, userType: "developer", overrides: {}, ...extra });

  it("lets a deny beat the role, even for an owner", () => {
    expect(requirePermission(staff("owner"), "billing.manage")).toBeNull();
    expect(
      requirePermission(staff("owner", { overrides: { "billing.manage": false } }), "billing.manage")
        ?.status
    ).toBe(403);
  });

  it("lets a grant reach past the role", () => {
    expect(requirePermission(staff("developer"), "task.review")?.status).toBe(403);
    expect(
      requirePermission(staff("developer", { overrides: { "task.review": true } }), "task.review")
    ).toBeNull();
  });

  it("authCan agrees with requirePermission on both", () => {
    expect(authCan(staff("owner", { overrides: { "billing.manage": false } }), "billing.manage")).toBe(false);
    expect(authCan(staff("developer", { overrides: { "task.review": true } }), "task.review")).toBe(true);
  });
});

describe("when overrides could not be read", () => {
  const broken = { role: "owner", userType: "developer", overridesUnavailable: true };

  it("answers 503, not 403 and not success", () => {
    // 403 would say "you may not", which is a claim we cannot make. Success
    // would ignore a deny we failed to read. 503 says what is true: ask again.
    const res = requirePermission(broken, "billing.manage");
    expect(res?.status).toBe(503);
  });

  it("refuses even the permission the role plainly holds", () => {
    // An owner holds billing.manage by role. The point is that we cannot know
    // whether somebody revoked it.
    expect(authCan(broken, "billing.manage")).toBe(false);
  });

  it("still refuses a client first, whatever the override state", () => {
    const client = { role: "owner", userType: "client", overridesUnavailable: true };
    expect(requirePermission(client, "billing.manage")?.status).toBe(403);
    expect(authCan(client, "billing.manage")).toBe(false);
  });
});

describe("the guards stayed synchronous, and that is load-bearing", () => {
  it("requirePermission returns a response or null, never a promise", () => {
    /**
     * The first version of this feature made both helpers async and loaded
     * overrides inside them. `authCan` is used as `if (!authCan(...))`, and an
     * un-awaited Promise is truthy — so `!Promise` is false and the guard
     * silently never fires. A helper whose misuse GRANTS access is a bad
     * helper however careful its call sites are today.
     *
     * Overrides now ride on `auth`, loaded once by getAuthedOrg, and these
     * stay pure functions of data already in hand.
     */
    const out = requirePermission({ role: "developer", userType: "developer" }, "billing.view");
    expect(out).not.toBeInstanceOf(Promise);
    expect(authCan({ role: "owner", userType: "developer" }, "billing.view")).toBe(true);
  });

  it("getAuthedOrg is the one place that reads them", () => {
    const auth = read("src/utils/serverAuth.js");
    expect(auth).toContain("loadOverrides(admin, { orgId, appUserId, userType })");
    expect(auth).toContain("overridesUnavailable");
    // And the guards do no I/O of their own.
    expect(read("src/utils/serverPermissions.js")).not.toContain("loadOverrides");
  });

  it("does not import serviceClient back out of serverAuth", () => {
    // serverAuth imports this module; importing it back is a cycle that
    // resolves to undefined at module-init and fails in production, on the
    // auth path. The client is passed in instead.
    expect(read("src/utils/permissionOverrides.js")).not.toContain("@/utils/serverAuth");
  });
});
