import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The route-protection middleware — and specifically, that it RUNS.
 *
 * WHY THIS FILE EXISTS
 *  `middleware.ts` sat at the repository root for months and was never
 *  compiled. Next resolves middleware next to the app directory, and this
 *  project keeps its app under `src/`, so `src/middleware.ts` is the path that
 *  is built and a root-level `middleware.ts` is silently ignored. No warning,
 *  no error, no failing test — the code was correct and simply never executed.
 *
 *  Measured against production before the move: GET /admin/dashboard,
 *  /developer/dashboard and /client all answered 200 to an anonymous request.
 *
 *  Every test below therefore checks a fact about DELIVERY, not about logic.
 *  Reviewing the middleware's rules would have proved nothing — they were
 *  already right.
 */

const root = path.resolve(__dirname, "..");
const MIDDLEWARE = "src/middleware.ts";

describe("the middleware is where Next will actually find it", () => {
  it("lives under src/, next to the app directory", () => {
    expect(existsSync(path.join(root, MIDDLEWARE))).toBe(true);
  });

  it("does NOT also sit at the repository root, where it would be ignored", () => {
    // Two copies would be worse than one in the wrong place: the ignored one
    // reads as authoritative and would drift from the one that runs.
    expect(existsSync(path.join(root, "middleware.ts"))).toBe(false);
    expect(existsSync(path.join(root, "middleware.js"))).toBe(false);
  });

  it("is compiled into the build", () => {
    // The only check that would have caught the original bug. Skipped when
    // there is no build to inspect, so a fresh checkout does not fail on it —
    // but any run that follows `next build` enforces it.
    const manifestPath = path.join(root, ".next/server/middleware-manifest.json");
    if (!existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(
      Object.keys(manifest.middleware || {}).length,
      "middleware-manifest.json is empty — the middleware is not being compiled"
    ).toBeGreaterThan(0);
  });
});

describe("what it gates, and what it must not", () => {
  const source = readFileSync(path.join(root, MIDDLEWARE), "utf8");

  it("covers all three areas", () => {
    for (const area of ["/admin", "/client", "/developer"]) {
      expect(source).toContain(`prefix: '${area}'`);
    }
    for (const matcher of ["/admin/:path*", "/client/:path*", "/developer/:path*"]) {
      expect(source).toContain(matcher);
    }
  });

  it("exempts /admin/registration, or signup becomes unreachable", () => {
    // The create-an-organization flow sits under /admin but is where sessions
    // COME FROM — nobody holds one there. Without this exemption, switching the
    // middleware on redirects every new signup to /login, which is to say it
    // takes the product off sale.
    expect(source).toContain("/admin/registration");
    expect(source).toMatch(/PUBLIC_PATHS[\s\S]{0,200}?\/admin\/registration/);
    // The exemption has to be tested BEFORE the area rules, or the rule matches
    // first and the exemption never runs.
    const exemptAt = source.indexOf("PUBLIC_PATHS.some");
    const ruleAt = source.indexOf("AREA_RULES.find");
    expect(exemptAt).toBeGreaterThan(-1);
    expect(exemptAt).toBeLessThan(ruleAt);
  });

  it("does not exempt anything that needs a session", () => {
    // /admin/upgrade is reached by a locked but SIGNED-IN admin. Exempting it
    // would hand an anonymous visitor the payment screen.
    expect(source).not.toMatch(/PUBLIC_PATHS[^\]]*\/admin\/upgrade/);
    expect(source).not.toMatch(/PUBLIC_PATHS[^\]]*\/admin\/dashboard/);
  });

  it("verifies a signed session rather than the presence of a cookie", () => {
    // The original defect this file's own comment describes: checking that a
    // cookie named `admin_auth` existed, when any browser can write one.
    expect(source).toContain("verifySession");
    expect(source).toContain("SESSION_COOKIE");
    expect(source).not.toMatch(/cookies\.get\('admin_auth'\)/);
  });

  it("fails closed — no session and a wrong user type both redirect", () => {
    expect(source).toMatch(/if \(!session\) \{[\s\S]{0,200}redirect/);
    expect(source).toMatch(/if \(!rule\.allow\(session\.userType\)\)[\s\S]{0,160}redirect/);
  });
});
