import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { wouldEscalateRole } from "@/utils/claimRepair";
import { isSubscriptionEntitled } from "@/utils/entitlements";
import { ROLE_RANK } from "@/utils/roles";

/**
 * The five findings the audit rated Critical.
 *
 * Each `describe` below is one of them, and each says what the hole WAS, because
 * a test that only states the rule does not tell the next person why the rule is
 * shaped the way it is — and this suite already contains one assertion that
 * asserted a bug (routeGuards listed demo-activate as `billing.manage`, the
 * exact swap that file exists to catch).
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

describe("C-1 · self-repair cannot raise a role", () => {
  /**
   * `auth_role()` reads app_metadata.role from the JWT, and every RLS policy is
   * built on it. /api/auth/repair-claims copies `memberships.role` into that
   * claim. RLS (018) lets owner, admin AND hr update membership rows and blocks
   * only the literal role 'owner' — no self-target rule, no rank rule. So an hr
   * could write their own row to 'admin' through PostgREST with the anon key the
   * browser already holds, call this route, refresh, and be an admin.
   */
  const claims = (role) => ({ role });
  const membership = (role) => ({ role });

  it("refuses a promotion", () => {
    expect(wouldEscalateRole(claims("hr"), membership("admin"))).toBe(true);
    expect(wouldEscalateRole(claims("developer"), membership("owner"))).toBe(true);
    expect(wouldEscalateRole(claims("manager"), membership("admin"))).toBe(true);
  });

  it("allows a demotion, so losing a role still propagates", () => {
    // The dangerous direction is the only one refused. A demotion that could
    // not be repaired would be a way to KEEP a role after being removed from it.
    expect(wouldEscalateRole(claims("admin"), membership("developer"))).toBe(false);
    expect(wouldEscalateRole(claims("owner"), membership("hr"))).toBe(false);
  });

  it("allows the case the route exists for: no role in the token at all", () => {
    // The legacy account whose claims were never written. There is no role to
    // raise, so there is nothing to refuse.
    for (const empty of [null, undefined, ""]) {
      expect(wouldEscalateRole({ role: empty }, membership("developer")), String(empty)).toBe(false);
      expect(wouldEscalateRole({ role: empty }, membership("owner")), String(empty)).toBe(false);
    }
    expect(wouldEscalateRole(null, membership("admin"))).toBe(false);
  });

  it("is a no-op when nothing changed", () => {
    expect(wouldEscalateRole(claims("manager"), membership("manager"))).toBe(false);
  });

  it("fails CLOSED on a role it does not recognise", () => {
    // An unknown role has no rank. Admitting it because it cannot be compared
    // is how a typo becomes an escalation — utils/roles.js records the day
    // atLeast() defaulted unknown roles to 99 and became fail-open.
    expect(wouldEscalateRole(claims("developer"), membership("superuser"))).toBe(true);
    expect(wouldEscalateRole(claims("nonsense"), membership("developer"))).toBe(true);
    expect(wouldEscalateRole({ role: "" }, membership("nope"))).toBe(true);
  });

  it("treats the developer/designer/devops tie as not a promotion", () => {
    // They share a rank on purpose: same work, same access.
    expect(ROLE_RANK.developer).toBe(ROLE_RANK.designer);
    expect(wouldEscalateRole(claims("developer"), membership("designer"))).toBe(false);
  });

  it("is enforced in resolveSelf, so GET cannot promise what POST refuses", () => {
    const src = read("src/app/api/auth/repair-claims/route.js");
    expect(src).toContain("wouldEscalateRole(claims, membership)");
    expect(src).toContain("role_would_escalate");
    // resolveSelf is shared by GET and POST; the guard must sit there and not
    // in POST alone, or the read-only inspection reports "will_repair".
    const resolve = src.slice(src.indexOf("async function resolveSelf"), src.indexOf("function describe("));
    expect(resolve).toContain("wouldEscalateRole");
  });

  it("has the database half, which is what the browser actually talks to", () => {
    const sql = read("database/070_membership_role_guard.sql");
    expect(sql).toContain("trg_memberships_role_guard");
    expect(sql).toMatch(/role_rank/);
    // hr must not be in the set allowed to move a role.
    expect(sql).toMatch(/v_actor_role in \('owner','admin'\)/);
    expect(sql).not.toMatch(/v_actor_role in \('owner','admin','hr'\)/);
    // self-target and rank rules both present
    expect(sql).toContain("auth_app_user_id()");
    expect(sql).toMatch(/v_new_rank < v_actor_rank/);
    expect(sql).toMatch(/v_old_rank < v_actor_rank/);
    // security invoker, not definer — a definer reports current_user as the
    // owner and the service-role exemption would then admit everybody.
    // Checked against the SQL with `--` comments stripped, because the file
    // deliberately WARNS about `security definer` in prose and matching that
    // warning would make this assertion fail on a correct file.
    const statements = sql.replace(/^\s*--.*$/gm, "");
    expect(statements).toContain("security invoker");
    expect(statements).not.toMatch(/security definer/i);
  });

  it("keeps the SQL rank table in step with ROLE_RANK", () => {
    // Two copies of one answer is the drift this whole phase has been removing.
    // They cannot be one file, so they are pinned to each other here.
    const sql = read("database/070_membership_role_guard.sql");
    for (const [role, rank] of Object.entries(ROLE_RANK)) {
      expect(sql, `${role} missing or wrong in role_rank()`).toMatch(
        new RegExp(`when '${role}'\\s*then ${rank}\\b`)
      );
    }
  });
});

describe("C-2 · provisioning cannot mint a credential for another tenant", () => {
  /**
   * /api/auth/provision created an `email_confirm: true` account for whatever
   * address it was handed, checking the caller's org, permission and rank — and
   * never the email. /api/auth/repair-claims then resolves identity by confirmed
   * email across EVERY membership on the platform. Provision an account for a
   * member of another org who has no auth account yet, sign in, POST
   * repair-claims, and the token becomes theirs — up to owner.
   */
  const src = read("src/app/api/auth/provision/route.js");

  it("looks the address up before creating the account", () => {
    const check = src.indexOf('.from("memberships")');
    const create = src.indexOf("auth.admin.createUser");
    expect(check).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(check).toBeLessThan(create);
  });

  it("compares the normalised address, the way 052 and repair-claims do", () => {
    expect(src).toMatch(/String\(email\)\.trim\(\)\.toLowerCase\(\)/);
  });

  it("refuses when the address belongs to a different organization", () => {
    expect(src).toMatch(/row\.organization_id[^\n]*!==[^\n]*auth\.orgId/);
    expect(src).toContain("email_taken");
  });

  it("does not name the other tenant in the refusal", () => {
    // "already in use" and nothing more. Saying which organization, or that
    // another organization exists, is most of the disclosure.
    const message = /That email address is already in use\./;
    expect(src).toMatch(message);
    expect(src).not.toMatch(/belongs to (another|the other) organization["']/);
  });

  it("fails closed when it cannot tell", () => {
    // Not knowing whether an address is taken is not a reason to mint a
    // confirmed credential for it.
    expect(src).toMatch(/emailErr[\s\S]{0,400}status:\s*503/);
  });
});

describe("C-3 · a demo plan is owner-only and expires", () => {
  it("asks for billing.purchase, not the wider billing.manage", () => {
    const src = read("src/app/api/billing/demo-activate/route.js");
    expect(src).toContain('requirePermission(auth, "billing.purchase")');
    expect(src).not.toContain('requirePermission(auth, "billing.manage")');
  });

  it("stops entitling a demo grant once its period has passed", () => {
    // DEMO_PERIOD_DAYS wrote current_period_end and nothing ever read it back —
    // it appeared only in display payloads — so every demo activation was
    // permanent, which is the opposite of what the route's comment claims.
    const sub = {
      status: "active",
      last_payment_status: "demo_paid",
      current_period_end: "2026-01-01T00:00:00.000Z",
    };
    expect(isSubscriptionEntitled(sub, new Date("2025-12-31T00:00:00.000Z"))).toBe(true);
    expect(isSubscriptionEntitled(sub, new Date("2026-01-02T00:00:00.000Z"))).toBe(false);
  });

  it("does NOT cut off a real subscription on the same condition", () => {
    // Stripe renews and the webhook moves the date afterwards. Treating a
    // lapsed period end as unentitled would lock out paying customers in the
    // window between the two.
    const real = {
      status: "active",
      last_payment_status: "paid",
      current_period_end: "2026-01-01T00:00:00.000Z",
    };
    expect(isSubscriptionEntitled(real, new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("leaves a demo grant with no period end alone rather than guessing", () => {
    const open = { status: "active", last_payment_status: "demo_paid", current_period_end: null };
    expect(isSubscriptionEntitled(open, new Date("2030-01-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("C-4 · screenshot ingest is bounded and typed", () => {
  const src = read("src/app/api/upload-screenshot/route.js");

  it("requires the decoded bytes to be a PNG", () => {
    // Buffer.from(_, 'base64') drops what it cannot decode and never throws, so
    // arbitrary bytes were stored under a hardcoded image/png content type.
    expect(src).toContain("function isPng(");
    expect(src).toMatch(/0x89[\s\S]{0,80}0x50[\s\S]{0,80}0x4e[\s\S]{0,80}0x47/);
    expect(src).toMatch(/isPng\(buffer\)[\s\S]{0,200}status:\s*415/);
  });

  it("decodes once and stores what it checked", () => {
    // Decoding a second time at the upload call would mean the bytes that were
    // validated and the bytes that were stored came from two different calls.
    expect(src).not.toContain("upload(fileName, base64ToBuffer(image_data)");
    expect(src).toContain("upload(fileName, buffer,");
  });

  it("rate limits per subject", () => {
    expect(src).toContain("rateLimited(`screenshot:${developer_id}`");
  });

  it("gives an anonymous caller no way to test whether a developer id is real", () => {
    // 403 "Unknown developer" versus 200 was a free identifier-validation
    // service, and the first step in forging captures against a named person.
    expect(src).toMatch(/if \(!auth\.authenticated\)[\s\S]{0,300}status: 202/);
  });

  it("still tells an AUTHENTICATED agent when its id is wrong", () => {
    expect(src).toMatch(/Unknown developer/);
  });
});

describe("C-5 · My Projects renders", () => {
  it("imports the function it calls", () => {
    const src = read("src/components/developer/MyProjects.jsx");
    expect(src).toMatch(
      /import\s*\{[^}]*\bprojectStatusMeta\b[^}]*\}\s*from\s*["']@\/utils\/projectStatus["']/
    );
  });
});
