import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Invariants that span files, and therefore belong to no single test.
 *
 * Every check here is a bug that actually happened. A check with no history
 * behind it fails for style reasons and gets deleted; these caught something.
 *
 * The one that keeps recurring: A LIST OF ROLES COPIED INTO A SECOND FILE.
 * It has happened five times in this codebase, and it never presents as
 * "a list is out of date" — it presents as a role you can assign but cannot
 * give a login to, or an invitation that fails for a role the database would
 * accept. Nobody connects those two screens.
 */

const root = path.resolve(__dirname, "..");
const SRC = path.join(root, "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES = walk(SRC).map((p) => ({
  path: path.relative(root, p),
  body: strip(readFileSync(p, "utf8")),
}));

const read = (p) => strip(readFileSync(path.join(root, p), "utf8"));

describe("there is exactly one role list", () => {
  it("nothing outside src/utils/roles.js declares ROLE_RANK", () => {
    const offenders = FILES.filter(
      (f) =>
        !f.path.endsWith("utils/roles.js") &&
        /(const|let|var)\s+ROLE_RANK\s*=\s*\{/.test(f.body)
    ).map((f) => f.path);
    expect(offenders, `ROLE_RANK redeclared in:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the valid-role list is derived, not typed out again", () => {
    const authorize = read("src/app/api/admin/members/role/authorize.js");
    expect(authorize).toContain("Object.keys(ROLE_RANK)");
  });

  it("no comparison treats an unknown role as the lowest one", () => {
    // `ROLE_RANK[x] || 0` folds "never heard of it" into "bottom of the
    // hierarchy", so a role the file has not been taught about sails through
    // every guard meant to stop it being granted.
    const offenders = FILES.filter((f) => /ROLE_RANK\[[^\]]+\]\s*\|\|\s*0/.test(f.body)).map(
      (f) => f.path
    );
    expect(offenders, `fail-open rank lookup in:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("every sidebar entry actually goes somewhere", () => {
  const nav = read("src/components/shell/navConfig.js");
  const titles = read("src/components/shell/sectionTitles.js");

  const idsOf = (constName) => {
    const m = nav.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\n\\];`));
    return m ? [...m[1].matchAll(/id: "([^"]+)"/g)].map((x) => x[1]) : [];
  };

  const ADMIN = idsOf("ADMIN_NAV");
  const CLIENT = idsOf("CLIENT_NAV");

  it("finds both navs", () => {
    expect(ADMIN.length).toBeGreaterThan(5);
    expect(CLIENT.length).toBeGreaterThan(3);
  });

  it.each(ADMIN)("admin section '%s' has a switch case and a title", (id) => {
    const page = read("src/app/admin/dashboard/page.js");
    // `overview` is the default branch rather than a case.
    if (id !== "overview") {
      expect(page, `no case for ${id}`).toContain(`case "${id}"`);
    }
    expect(titles, `no title for ${id}`).toMatch(new RegExp(`["']?${id}["']?\\s*:`));
  });

  it.each(CLIENT)("client section '%s' has a switch case and a title", (id) => {
    const page = read("src/app/client/page.jsx");
    if (id !== "overview") {
      expect(page, `no case for ${id}`).toContain(`case "${id}"`);
    }
    expect(titles, `no title for ${id}`).toMatch(new RegExp(`["']?${id}["']?\\s*:`));
  });
});

describe("notification categories are real", () => {
  const notif = read("src/utils/notifications.js");
  const m = notif.match(/export const CATEGORIES = \{([\s\S]*?)\n\};/);
  const valid = m ? [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]) : [];

  it("has a category map to check against", () => {
    expect(valid.length).toBeGreaterThan(5);
  });

  it("every notification insert uses one of them", () => {
    // An invented category still inserts — there is no CHECK — and then falls
    // through to `general` in the bell, losing its icon and the preference row
    // that would let someone mute it. That is how the trial-expiry reminder
    // ended up unfilterable.
    const bad = [];
    for (const f of FILES) {
      // `category:` is also uploadOrgFile's storage-path segment, so only look
      // at objects that are plainly notification rows.
      for (const match of f.body.matchAll(/\{[^{}]*?type:\s*[^,]+,[^{}]*?category:\s*"([^"]+)"/gs)) {
        if (!valid.includes(match[1])) bad.push(`${f.path}: ${match[1]}`);
      }
    }
    expect(bad, `unknown notification categories:\n${bad.join("\n")}`).toEqual([]);
  });
});

describe("service-role routes re-apply the scope RLS would have", () => {
  // serviceClient() bypasses RLS. A route that queries an org-scoped table
  // without filtering on the token's organization hands every tenant's rows to
  // whoever asked.
  //
  // The exemptions are routes that legitimately act across organizations, each
  // for a stated reason — not a list of things that were awkward to fix.
  const EXEMPT = {
    "cron/route.js": "runs for every organization on a schedule",
    "auth/repair-claims/route.js": "repairs a caller whose claims are missing",
    "auth/provision/route.js": "creates an account; scopes by the caller's org explicitly",
    "auth/verify-code/route.js": "pre-session, keyed on the emailed code",
    // NOTE: signup, forgot-password, session and invitations/accept are NOT
    // listed. They build their own Supabase client rather than calling
    // serviceClient(), so they never reach this check — and an exemption for
    // a route the check cannot see is how a real gap hides behind a name.
    "send-verification/route.js": "pre-session",
    "invitations/lookup/route.js": "pre-session, keyed on the invite token",
    "billing/webhook/route.js": "Stripe callback, verified by signature, keyed on customer id",
  };

  const routes = FILES.filter(
    (f) => f.path.includes("app/api/") && f.path.endsWith("route.js") && f.body.includes("serviceClient()")
  );

  it("finds the service-role routes", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it("each one either scopes to auth.orgId or is a stated exception", () => {
    const bad = [];
    for (const f of routes) {
      const rel = f.path.split("app/api/")[1];
      if (EXEMPT[rel]) continue;
      if (!f.body.includes("auth.orgId")) bad.push(rel);
    }
    expect(bad, `service-role routes with no org filter:\n${bad.join("\n")}`).toEqual([]);
  });

  it("keeps the exemption list honest — every exempt route still exists", () => {
    // An exemption for a deleted file is how a real gap gets hidden later by a
    // name that happens to match.
    const present = new Set(routes.map((f) => f.path.split("app/api/")[1]));
    const stale = Object.keys(EXEMPT).filter((k) => !present.has(k));
    expect(stale, `exemptions for routes that no longer use serviceClient:\n${stale.join("\n")}`).toEqual([]);
  });
});
