import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DASHBOARD_HOME, dashboardHomeFor } from "@/utils/dashboardHome";

/**
 * The marketing header, for a visitor who is already signed in.
 *
 * THE BUG THIS FILE EXISTS FOR
 *
 *  Sign in, go to the dashboard, then visit the marketing page — and the header
 *  still offered "Sign in", "Join with an invite" and "Create an organization".
 *  Three answers to "you do not have an account yet", every one of them wrong
 *  for somebody who does, and no way back into the product except editing the
 *  address bar.
 *
 *  It had two independent causes, and fixing either one alone would have left
 *  the report half-true:
 *
 *   1. AuthContext.checkAuth never looked at the stored CLIENT session. A
 *      signed-in client was, to every consumer of this context, anonymous.
 *   2. The login page dispatches `auth-change`; this context listened only for
 *      `auth-state-changed`. So a hard page load re-read the session and looked
 *      right, while an in-app navigation after signing in did not — which is
 *      exactly the kind of split that makes a bug report sound wrong.
 *
 * WHY THE ASSERTIONS READ SOURCE TEXT
 *
 *  Same reason as tests/authRouting.test.js, which this file sits beside: the
 *  test environment is `node` with no DOM, and the regressions being guarded
 *  are regressions of FORM — a gate deleted, a hardcoded route reintroduced, a
 *  listener dropped, `cookies()` added to a static page. The shape of the
 *  source is the thing under protection.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const NAV = "src/components/landing/SiteNav.jsx";
const CONTEXT = "src/contexts/AuthContext.jsx";
const HOME = "src/utils/dashboardHome.js";
const LANDING = "src/app/page.js";
const COMMANDS = "src/components/shell/searchCommands.js";

/** Source with block and line comments removed — comments are not code. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Index of a needle, asserting it is actually present first.
 *
 * `indexOf` returns -1 for something that is missing, and -1 is less than every
 * real index — so a naive "A comes before B" passes when A has been DELETED.
 * That trap has already been walked into once in this suite.
 */
function at(haystack, needle) {
  const index = haystack.indexOf(needle);
  expect(index, `expected to find ${JSON.stringify(needle)}`).toBeGreaterThan(-1);
  return index;
}

describe("dashboardHomeFor", () => {
  it("answers for each of the three profile types", () => {
    expect(dashboardHomeFor("admin")).toBe("/admin/dashboard");
    expect(dashboardHomeFor("developer")).toBe("/developer/dashboard");
    expect(dashboardHomeFor("client")).toBe("/client");
  });

  it("returns null for anything else rather than guessing a dashboard", () => {
    // A wrong guess here does not fail visibly — it produces a button that
    // sends the user to a route the middleware bounces, which reads as "my
    // session broke" rather than "that value was not a user type".
    for (const value of ["manager", "qa", "owner", "", "ADMIN", " admin"]) {
      expect(dashboardHomeFor(value), `for ${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("returns null for a non-string, including the ones a stale session yields", () => {
    for (const value of [null, undefined, 0, {}, [], true]) {
      expect(dashboardHomeFor(value)).toBeNull();
    }
  });

  it("cannot be mutated by a caller", () => {
    expect(Object.isFrozen(DASHBOARD_HOME)).toBe(true);
  });

  it("is pure — no session, no storage, no React", () => {
    // This is what lets the command palette, the marketing header, the login
    // page and any server code all read the same map. The rule was originally
    // "no imports at all"; it now imports sectionAccess.js, which is itself
    // pure — so the rule is stated as what it was protecting: nothing that
    // needs a browser, a session or a network.
    const source = read(HOME);
    expect(source).not.toMatch(/sessionStorage|localStorage|document\./);
    expect(source).not.toMatch(/supabase|sessionPolicy|orgContext|react/i);
    const imports = source.match(/^import .*$/gm) || [];
    expect(imports).toEqual([
      'import { canEnterAdminArea } from "@/components/shell/sectionAccess";',
    ]);
  });
});

describe("one copy of the dashboard routes", () => {
  it("the command palette reads the shared map instead of its own", () => {
    const source = stripComments(read(COMMANDS));
    expect(source).toMatch(/import \{ DASHBOARD_HOME \} from "@\/utils\/dashboardHome"/);
    // The literals it used to carry. Re-adding one is how /client gets renamed
    // in two places out of three.
    expect(source).not.toMatch(/["']\/admin\/dashboard["']/);
    expect(source).not.toMatch(/["']\/developer\/dashboard["']/);
  });
});

describe("AuthContext sees every signed-in user", () => {
  const source = read(CONTEXT);
  const code = stripComments(source);

  it("reads the stored client session, not only admin and developer", () => {
    expect(code).toMatch(/getStoredClientSession/);
    expect(code).toMatch(/const clientData = getStoredClientSession\(\)/);
    expect(code).toMatch(/setIsLoggedIn\(true\)/);
  });

  it("clears an expired client session rather than trusting it", () => {
    expect(code).toMatch(/isSessionExpired\(clientData\)/);
    expect(code).toMatch(/clearClientSession\(\)/);
  });

  it("checks the client LAST, so an admin holding a stale client session is still an admin", () => {
    const admin = at(code, "getStoredAdminSession()");
    const developer = at(code, "getStoredDeveloperSession()");
    const client = at(code, "getStoredClientSession()");
    expect(admin).toBeLessThan(developer);
    expect(developer).toBeLessThan(client);
  });

  it("listens for BOTH names the app dispatches for one event", () => {
    // The login page fires `auth-change`; this context fires
    // `auth-state-changed`. Dropping either listener resurrects the
    // "signed in, but only after a full page load" half of the bug.
    expect(code).toMatch(/addEventListener\('auth-state-changed'/);
    expect(code).toMatch(/addEventListener\('auth-change'/);
    expect(code).toMatch(/removeEventListener\('auth-state-changed'/);
    expect(code).toMatch(/removeEventListener\('auth-change'/);
  });

  it("publishes the dashboard route as derived state", () => {
    // BOTH arguments. Passing only `user?.role` sends a project manager, a
    // team lead, an HR user, a QA and a finance user to the staff dashboard —
    // they are all `developer` in the profile table, and none of their work is
    // on that surface.
    expect(code).toMatch(/dashboardHomeFor\(user\?\.role, user\?\.membership_role\)/);
    expect(code).toMatch(/const home = isLoggedIn \? dashboardHomeFor/);
    // Exported through the provider value, or no consumer can read it.
    expect(code).toMatch(/const contextValue = \{[\s\S]*?\bhome,[\s\S]*?\}/);
  });

  it("still hard-navigates on logout and on expiry", () => {
    // Two deliberate `window.location` assignments live in this file and are
    // the only correct ones in the app — they destroy the document, and with
    // it the live Supabase subscriptions the old session opened. Nothing in
    // this change touches them; this asserts nothing quietly did.
    const hard = code.match(/window\.location\.href = ['"]/g) || [];
    expect(hard.length).toBe(2);
  });
});

describe("SiteNav offers the dashboard to somebody already signed in", () => {
  const source = read(NAV);
  const code = stripComments(source);

  it("takes the answer from the auth context", () => {
    expect(code).toMatch(/import \{ useAuth \} from "@\/contexts\/AuthContext"/);
    expect(code).toMatch(/const \{ isLoading: authLoading, isLoggedIn, home \} = useAuth\(\)/);
  });

  it("waits for the check to settle before claiming anybody is signed in", () => {
    // Without `!authLoading` this renders the Dashboard button on the server —
    // where sessionStorage does not exist — and React reconciles a different
    // tree on the client. A hydration mismatch, not a cosmetic flicker.
    expect(code).toMatch(/const signedIn = !authLoading && isLoggedIn && Boolean\(home\)/);
  });

  it("never reads the session itself", () => {
    // A second reader of "who is signed in" is a second answer to it. This one
    // would also be a server-render crash: the file is imported by a static
    // page.
    expect(code).not.toMatch(/sessionStorage|localStorage|document\.cookie/);
    expect(code).not.toMatch(/getStored(Admin|Developer|Client)Session/);
  });

  it("points the button at the context's route, never a literal", () => {
    expect(code).toMatch(/<CtaButton href=\{home\}/);
    expect(code).not.toMatch(/["']\/admin\/dashboard["']/);
    expect(code).not.toMatch(/["']\/client["']/);
  });

  it("renders it in the bar AND in the mobile panel", () => {
    const buttons = code.match(/href=\{home\}/g) || [];
    expect(buttons.length).toBe(2);
    const dashboardLabels = code.match(/^\s*Dashboard$/gm) || [];
    expect(dashboardLabels.length).toBe(2);
  });

  it("hides all three signed-out actions behind the same gate", () => {
    // The whole complaint was these three being offered to someone who is
    // already in. Each must be conditional on NOT being signed in — in the bar
    // (one ternary around the group) and in the panel (three guards, because
    // the panel stacks them individually).
    const bar = code.slice(at(code, "ml-auto hidden items-center"), at(code, "ref={toggleRef}"));
    expect(bar).toMatch(/\{signedIn \? \(/);
    expect(bar).toMatch(/navSignIn \?/);
    expect(bar).toMatch(/navSecondary \?/);
    expect(bar).toMatch(/navPrimary \?/);

    const panel = code.slice(at(code, "id=\"site-nav-panel\""));
    expect(panel).toMatch(/\{!signedIn && navPrimary \?/);
    expect(panel).toMatch(/\{!signedIn && navSecondary \?/);
    expect(panel).toMatch(/\{!signedIn && navSignIn \?/);
  });

  it("still shows the mobile action block when the only action is Dashboard", () => {
    // The block used to render only if one of the three marketing actions
    // existed. Left alone, a signed-in visitor on a phone would open the menu
    // and find no way into the product at all.
    expect(panelGate(code)).toMatch(/signedIn \|\| navPrimary/);
  });

  it("navigates with the app router, not a document load", () => {
    expect(code).not.toMatch(/window\.location\.href\s*=/);
  });
});

/** The condition guarding the mobile panel's action block. */
function panelGate(code) {
  const start = at(code, "</Container>\n\n          {");
  return code.slice(start, start + 120);
}

describe("the landing page stays static", () => {
  it("does not read cookies or headers to personalise the header", () => {
    // Personalising on the server would work, and would turn every visit to
    // the marketing page into an SSR request. The header resolves the session
    // in the browser instead, which is why `signedIn` waits on `authLoading`
    // above. Verified against the build output: `/` is still ○ (Static).
    const code = stripComments(read(LANDING));
    expect(code).not.toMatch(/next\/headers/);
    expect(code).not.toMatch(/\bcookies\(\)/);
    expect(code).not.toMatch(/force-dynamic/);
  });
});
