import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  resolveAppOrigin,
  resetRedirectUrl,
  RESET_PASSWORD_PATH,
} from "@/components/auth/resetRedirect";
import { evaluatePassword } from "@/components/auth/passwordRules";

/**
 * Authentication ROUTING, presentation and the password-reset flow.
 *
 * WHAT THIS FILE IS FOR
 *  Four separate defects lived in how this app moved people between its auth
 *  screens, and every one of them is the kind that comes back the moment
 *  someone edits the file for an unrelated reason:
 *
 *   1. A logged-out visitor hitting a protected route was bounced with no
 *      explanation — a blank frame, then /login.
 *   2. Auth screens navigated with full page loads, throwing away the React
 *      tree to render a form. TWO hard loads are correct and must survive: the
 *      post-logout redirect and the session-expiry redirect in AuthContext,
 *      where destroying the document is the entire point.
 *   3. "Join with an invite" and "Create an organization" were one destination
 *      wearing a mode toggle.
 *   4. There was no way to reset a forgotten password at all.
 *
 *  The reset flow is the one with teeth, so it gets the most assertions: it
 *  must use Supabase's own primitives (no invented token scheme), it must not
 *  hardcode a host in the link it emails, and the page that sets the new
 *  password must be unreachable without the session the emailed link
 *  establishes.
 *
 *  Assertions that read source text are doing so on purpose. The regressions
 *  above are regressions of FORM — an `<a href>` where a `<Link>` belongs, a
 *  hardcoded hostname, a guard deleted — and the shape of the source is
 *  precisely what is being protected.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const LOGIN = "src/app/login/page.js";
const JOIN = "src/app/join/page.jsx";
const FORGOT = "src/app/forgot-password/page.jsx";
const RESET = "src/app/reset-password/page.jsx";
const FORGOT_ROUTE = "src/app/api/auth/forgot-password/route.js";
const CONTEXT = "src/contexts/AuthContext.jsx";
const GUARD = "src/components/auth/ProtectedRoute.jsx";
const LOADING = "src/components/auth/AuthLoadingScreen.jsx";

/** Every file this agent owns, for the sweeps that apply to all of them. */
const OWNED = [LOGIN, JOIN, FORGOT, RESET, CONTEXT, GUARD, LOADING];

/** Source with block and line comments removed — for "is it really in the code". */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// 1. The branded protected-route wait
// ---------------------------------------------------------------------------

describe("protected-route loading screen", () => {
  it("exists as its own component", () => {
    expect(existsSync(path.join(root, LOADING))).toBe(true);
    expect(existsSync(path.join(root, GUARD))).toBe(true);
  });

  it("is branded: the Logo component and the product name constant", () => {
    const source = read(LOADING);
    expect(source).toMatch(/from "@\/components\/brand"/);
    expect(source).toMatch(/\bLogo\b/);
    expect(source).toMatch(/BRAND_NAME/);
    // The name is never retyped as a literal — one rename, one line.
    expect(source).not.toMatch(/Verisade/);
  });

  it("sits on the brand ground, using tokens and never a literal colour", () => {
    const source = read(LOADING);
    expect(source).toMatch(/bg-sidebar/);
    expect(source).toMatch(/text-sidebar-primary/);
    // No hex, no rgb(), no bg-white / bg-gray-* / text-gray-* — per the UI kit
    // contract, a literal colour is what breaks dark mode.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
    expect(source).not.toMatch(/\b(bg|text|border)-(white|black|gray|slate|zinc)-/);
  });

  it("announces itself to assistive technology rather than spinning silently", () => {
    const source = read(LOADING);
    expect(source).toMatch(/role="status"/);
    expect(source).toMatch(/aria-live="polite"/);
    expect(source).toMatch(/aria-busy/);
  });

  it("respects prefers-reduced-motion on everything that moves", () => {
    const source = read(LOADING);
    const animated = source.match(/animate-[a-z-]+/g) || [];
    expect(animated.length).toBeGreaterThan(0);
    expect(source).toMatch(/motion-reduce:animate-none/);
  });
});

describe("ProtectedRoute", () => {
  const source = read(GUARD);
  const code = stripComments(source);

  it("renders the branded screen while pending and while denied", () => {
    expect(code).toMatch(/AuthLoadingScreen/);
    expect(code).toMatch(/loadingMessage/);
    expect(code).toMatch(/deniedMessage/);
  });

  it("renders children — never the loading screen — once allowed", () => {
    // The single return that hands back children is gated on "allowed".
    expect(code).toMatch(/if\s*\(\s*effective === "allowed"\s*\)\s*return children/);
  });

  it("makes 'allowed' sticky so it cannot flash at an authenticated user", () => {
    expect(code).toMatch(/allowedRef/);
    expect(code).toMatch(/allowedRef\.current\s*=\s*true/);
    expect(code).toMatch(/allowedRef\.current\s*\?\s*"allowed"/);
  });

  it("resolves the shared check before paint, via a layout effect", () => {
    // A passive effect settles after the first paint, which is exactly the
    // frame an already-signed-in user would see the loading screen in.
    expect(code).toMatch(/useIsomorphicLayoutEffect/);
    expect(code).toMatch(/useLayoutEffect/);
    expect(code).toMatch(/typeof window === "undefined" \? useEffect : useLayoutEffect/);
  });

  it("fails closed when a custom check throws", () => {
    expect(code).toMatch(/\.catch\([\s\S]*?setCustomStatus\("denied"\)/);
  });

  it("redirects client-side, and does not re-derive any role rule", () => {
    expect(code).toMatch(/router\.replace\(/);
    expect(code).not.toMatch(/window\.location\.href/);
    // The guard reads the centralised check. It must not grow its own notion of
    // who is an admin / developer / client.
    expect(code).toMatch(/useAuth\(\)/);
    expect(code).not.toMatch(/signInWithPassword|admin_users|developers|clients/);
    expect(code).not.toMatch(/userType|membership_role/);
  });
});

// ---------------------------------------------------------------------------
// 2. Client-side navigation, and the two hard loads that must survive
// ---------------------------------------------------------------------------

describe("navigation is client-side", () => {
  it("no auth screen uses an <a href> for an internal route", () => {
    for (const file of OWNED) {
      const code = stripComments(read(file));
      expect(code, `${file} must not hand-roll an internal anchor`).not.toMatch(
        /<a\s+[^>]*href=["']\//
      );
    }
  });

  it("the login, join, forgot and reset screens contain no window.location navigation", () => {
    for (const file of [LOGIN, JOIN, FORGOT, RESET]) {
      const code = stripComments(read(file));
      expect(code, `${file} must not assign window.location`).not.toMatch(
        /window\.location\s*(\.href)?\s*=/
      );
      expect(code, `${file} must not call location.replace/assign`).not.toMatch(
        /window\.location\.(replace|assign)\(/
      );
    }
  });

  it("those screens navigate with next/link or the router instead", () => {
    for (const file of [LOGIN, JOIN, FORGOT, RESET]) {
      const source = read(file);
      expect(source, `${file}`).toMatch(/from "next\/link"/);
      expect(source, `${file}`).toMatch(/router\.(push|replace)\(|<Link\b/);
    }
  });

  it("KEEPS the post-logout hard reload, and says why", () => {
    const source = read(CONTEXT);
    expect(source).toMatch(/window\.location\.href = '\/'/);
    // The comment is load-bearing: it is what stops the next reader "fixing" it.
    expect(source).toMatch(/DELIBERATE HARD NAVIGATION — DO NOT CONVERT/);
    expect(source).toMatch(/realtime/);
  });

  it("KEEPS the session-expiry hard reload, and says why", () => {
    const source = read(CONTEXT);
    expect(source).toMatch(/window\.location\.href = '\/login'/);
    // Both sites carry the warning, not just the first one.
    const warnings = source.match(/DELIBERATE HARD NAVIGATION/g) || [];
    expect(warnings.length).toBe(2);
  });

  it("adds no THIRD hard navigation to AuthContext", () => {
    const assignments =
      stripComments(read(CONTEXT)).match(/window\.location\.href\s*=/g) || [];
    expect(assignments.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. The two entry paths are two routes
// ---------------------------------------------------------------------------

describe("the invite path has its own route", () => {
  it("/join exists", () => {
    expect(existsSync(path.join(root, JOIN))).toBe(true);
  });

  it("is built against the existing accept + lookup routes", () => {
    const code = stripComments(read(JOIN));
    expect(code).toMatch(/\/api\/invitations\/lookup\?token=/);
    expect(code).toMatch(/"\/api\/invitations\/accept"/);
    expect(code).toMatch(/method: "POST"/);
    // The accept route refuses without it, and the checkbox starts unticked.
    expect(code).toMatch(/termsAccepted/);
    expect(code).toMatch(/useState\(false\)/);
  });

  it("neither API route was modified", () => {
    // The lookup stays public-by-design and service-role backed...
    const lookup = read("src/app/api/invitations/lookup/route.js");
    expect(lookup).toMatch(/serviceClient/);
    expect(lookup).toMatch(/\.eq\("token", token\)/);
    // ...and the accept route is still the only thing that creates the account.
    const accept = read("src/app/api/invitations/accept/route.js");
    expect(accept).toMatch(/admin\.auth\.admin\.createUser/);
    expect(accept).toMatch(/termsAccepted !== true/);
    expect(accept).toMatch(/checkSeatLimitForRole/);
    expect(accept).toMatch(/status: "accepted"/);
  });

  it("holds no credential logic of its own — the server decides everything", () => {
    const code = stripComments(read(JOIN));
    expect(code).not.toMatch(/signInWithPassword/);
    expect(code).not.toMatch(/auth\.admin/);
    expect(code).not.toMatch(/service_role|SERVICE_ROLE/);
    // It must not pick the role or the profile table — the invitation did.
    expect(code).not.toMatch(/admin_users|from\("developers"\)/);
  });

  it("names each guard state instead of showing one generic failure", () => {
    const code = stripComments(read(JOIN));
    for (const state of ["not-found", "revoked", "accepted", "expired"]) {
      expect(code, state).toContain(state);
    }
  });

  it("the sign-in screen offers both paths, separately and by name", () => {
    const source = read(LOGIN);
    expect(source).toMatch(/href="\/join"/);
    expect(source).toMatch(/Join with an Invite/);
    expect(source).toMatch(/href="\/admin\/registration"/);
    expect(source).toMatch(/Create an Organization/);
    // The old, ambiguous label is gone.
    expect(source).not.toMatch(/>\s*Create one\s*</);
  });
});

// ---------------------------------------------------------------------------
// 4. Forgot / reset password
// ---------------------------------------------------------------------------

describe("reset redirect origin", () => {
  it("prefers NEXT_PUBLIC_APP_URL", () => {
    expect(resolveAppOrigin("https://app.example.com", "https://evil.test")).toBe(
      "https://app.example.com"
    );
  });

  it("falls back to the request origin", () => {
    expect(resolveAppOrigin("", "https://preview-7.vercel.app")).toBe(
      "https://preview-7.vercel.app"
    );
    expect(resolveAppOrigin(undefined, "http://localhost:3456")).toBe(
      "http://localhost:3456"
    );
  });

  it("never invents a host when it knows neither", () => {
    expect(resolveAppOrigin("", "")).toBe("");
    expect(resolveAppOrigin(undefined, undefined)).toBe("");
    // A relative path means "use the project's configured Site URL", which is
    // the right answer — a wrong absolute host is worse than none.
    expect(resetRedirectUrl(undefined, undefined)).toBe("/reset-password");
  });

  it("does not double the slash when the configured URL has a trailing one", () => {
    expect(resetRedirectUrl("https://app.example.com/", "")).toBe(
      "https://app.example.com/reset-password"
    );
    expect(resetRedirectUrl("https://app.example.com///", "")).toBe(
      "https://app.example.com/reset-password"
    );
  });

  it("always lands on the reset route", () => {
    expect(RESET_PASSWORD_PATH).toBe("/reset-password");
    expect(resetRedirectUrl("https://a.test", "")).toMatch(/\/reset-password$/);
  });

  it("hardcodes no hostname anywhere in the flow", () => {
    for (const file of [FORGOT, RESET, "src/components/auth/resetRedirect.js"]) {
      const code = stripComments(read(file));
      expect(code, file).not.toMatch(/https?:\/\/(?!localhost)[a-z0-9.-]+/i);
    }
  });
});

describe("forgot-password", () => {
  const code = stripComments(read(FORGOT));

  // WHAT CHANGED HERE, AND WHY THESE ASSERTIONS MOVED
  //
  // This page used to call `supabase.auth.resetPasswordForEmail()` in the
  // browser, and these tests asserted "no API route" to pin that down. That
  // also meant SUPABASE sent the email — its template, its sender, its wording
  // — so what arrived in the inbox named a service the recipient has never
  // heard of, about an account they hold with us.
  //
  // Delivery now goes through /api/auth/forgot-password, which mints the same
  // recovery link with `auth.admin.generateLink()` and mails it through the
  // product's own branded template. The invariant that mattered was never
  // "no API route" — it was "no token scheme of our own". That one is asserted
  // harder than before, on BOTH files.
  it("invents no token scheme of its own", () => {
    expect(code).not.toMatch(/crypto\.|randomUUID|token_hash|reset_token/);
    // Still off-limits: neither of the two routes this flow must not touch.
    expect(code).not.toMatch(/\/api\/auth\/signup/);
    expect(code).not.toMatch(/change-password/);
  });

  it("posts to the branded send route rather than mailing from the browser", () => {
    expect(code).toMatch(/\/api\/auth\/forgot-password/);
    // The browser no longer triggers Supabase's own email.
    expect(code).not.toMatch(/resetPasswordForEmail/);
  });

  it("sends the address and nothing else — never a redirect target", () => {
    expect(code).toMatch(/JSON\.stringify\(\{\s*email:\s*address\s*\}\)/);
    // A caller-chosen redirectTo is how a real reset link gets mailed to a
    // victim pointing at a host the attacker controls. The server builds it.
    expect(code).not.toMatch(/redirectTo/);
    expect(code).not.toMatch(/currentResetRedirectUrl/);
  });

  it("does not leak whether an account exists", () => {
    // One confirmation state, reached on success, worded conditionally.
    expect(read(FORGOT)).toMatch(/If an account exists for/);
    expect(code).not.toMatch(/no account|not found|doesn't exist/i);
  });

  it("reports failures through the shared alert helpers", () => {
    expect(code).toMatch(/from "@\/utils\/alerts"/);
    expect(code).toMatch(/showError\(/);
  });
});

/**
 * The route that actually sends the mail.
 *
 * It exists for one reason: to move the ENVELOPE off Supabase without moving
 * the TOKEN. Everything asserted below is about keeping that line in place —
 * Supabase still owns what a valid link is, we own what the message looks like.
 */
describe("the branded reset-link route", () => {
  const source = read(FORGOT_ROUTE);
  const code = stripComments(source);

  it("exists", () => {
    expect(existsSync(path.join(root, FORGOT_ROUTE))).toBe(true);
  });

  it("mints Supabase's own recovery link instead of inventing one", () => {
    expect(code).toMatch(/generateLink\(/);
    expect(code).toMatch(/type:\s*"recovery"/);
    expect(code).toMatch(/action_link/);
    // No home-grown token, nowhere to store one, and no second idea of expiry.
    expect(code).not.toMatch(/randomUUID|token_hash|reset_token|createHash/);
  });

  it("builds the redirect target itself and never reads one from the body", () => {
    expect(code).toMatch(/resolveAppOrigin\(/);
    expect(code).toMatch(/RESET_PASSWORD_PATH/);
    expect(code).toMatch(/NEXT_PUBLIC_APP_URL/);
    // `body.redirectTo` in any form is the open-redirect-by-email bug.
    expect(code).not.toMatch(/body\.redirectTo|body\.redirect_to|body\["redirectTo"\]/);
  });

  it("answers identically whether or not the account exists", () => {
    // One helper produces the happy-path body, and every success path returns
    // it — including the branch where no link could be minted at all.
    expect(code).toMatch(/function accepted\(\)/);
    expect(code).toMatch(/return accepted\(\);/);
    expect(code).not.toMatch(/no account|not found|does not exist|user not found/i);
    // The link itself must never appear in a response body.
    expect(code).not.toMatch(/json\([^)]*action_link/);
  });

  it("keeps the service-role key server-side and reports nothing back about it", () => {
    expect(code).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE/);
    // Transport errors are logged, never returned — an SMTP client will quote
    // the credential it just tried inside its own error string.
    expect(code).not.toMatch(/details:\s*(result\.error|e\.message|error\.message)/);
  });

  it("rate-limits by address and by caller", () => {
    expect(code).toMatch(/rateLimited\(`ip:/);
    expect(code).toMatch(/rateLimited\(`to:/);
    expect(code).toMatch(/status:\s*429/);
  });

  it("sends through the product's own template and send path", () => {
    expect(code).toMatch(/renderTemplate\("password_reset"/);
    expect(code).toMatch(/sendEmail\(/);
    // Mock mode reports ok:true with delivered:false. Treating that as sent is
    // how a reset flow goes silently dead in an unconfigured deploy.
    expect(code).toMatch(/!result\.delivered/);
  });
});

describe("the reset email is ours, not Supabase's", () => {
  const templates = read("src/utils/emailTemplates.js");

  it("has a password_reset template", async () => {
    const { TEMPLATE_NAMES, renderTemplate } = await import("@/utils/emailTemplates");
    expect(TEMPLATE_NAMES).toContain("password_reset");

    const { subject, html, text } = renderTemplate("password_reset", {
      userName: "Zohaib",
      email: "person@example.com",
      resetUrl: "https://example.com/reset-password#access_token=abc",
      expiresInMinutes: 60,
    });

    // Branded by the product name, not by the auth vendor.
    expect(subject).toMatch(/Verisade/);
    expect(html).not.toMatch(/[Ss]upabase/);
    expect(text).not.toMatch(/[Ss]upabase/);

    // The link survives into both parts, and the button says what it does.
    expect(html).toContain("https://example.com/reset-password");
    expect(text).toContain("https://example.com/reset-password");
    expect(html).toMatch(/Set a new password/);

    // The line that has to reach someone who did not request the reset.
    expect(html).toMatch(/did not ask for this/i);
    expect(html).toMatch(/never email you asking for your password/i);
  });

  it("refuses a link that is not http(s)", async () => {
    const { renderTemplate } = await import("@/utils/emailTemplates");
    const { html } = renderTemplate("password_reset", {
      email: "person@example.com",
      resetUrl: "javascript:alert(1)",
    });
    expect(html).not.toMatch(/javascript:/i);
  });

  it("uses the brand indigo, not the pre-rename teal", () => {
    expect(templates).toMatch(/#4840DD/i);
    expect(templates).not.toMatch(/#009578/i);
  });

  it("signs mail with the current product name", () => {
    // Comments stripped: the old name survives in the note explaining why it
    // was replaced, which is exactly where it belongs.
    const provider = stripComments(read("src/utils/emailProvider.js"));
    expect(provider).not.toMatch(/"Developer Activity Tracking System"/);
    expect(provider).toMatch(/DEFAULT_FROM_NAME = BRAND_NAME/);
  });
});

describe("reset-password is unreachable without a live session", () => {
  const source = read(RESET);
  const code = stripComments(source);

  it("wraps the form in the guard", () => {
    expect(code).toMatch(/<ProtectedRoute/);
    expect(code).toMatch(/check=\{hasRecoverySession\}/);
    expect(code).toMatch(/<ResetPasswordForm\s*\/>/);
  });

  it("the check asks Supabase for a real session", () => {
    expect(code).toMatch(/supabase\.auth\.getSession\(\)/);
    expect(code).toMatch(/onAuthStateChange/);
  });

  it("fails closed on every negative branch", () => {
    // An error in the URL (expired / already-used link).
    expect(code).toMatch(/urlCarriesAuthError\(\)\) return false/);
    // getSession itself erroring.
    expect(code).toMatch(/if \(error\) return false/);
    // A direct visit with no recovery token in the URL at all.
    expect(code).toMatch(/urlCarriesRecoveryToken\(\)\) return false/);
  });

  it("waits for the fragment to be consumed, but never forever", () => {
    // detectSessionInUrl parses asynchronously, so an immediate getSession
    // would deny a legitimate arrival; an unbounded wait would park a stranger
    // on the loading screen indefinitely.
    expect(code).toMatch(/SESSION_GRACE_MS/);
    expect(code).toMatch(/setTimeout\(\(\) => finish\(false\), ms\)/);
    expect(code).toMatch(/waitForSession\(SESSION_GRACE_MS\)/);
  });

  it("sends a denied visitor somewhere useful", () => {
    expect(code).toMatch(/redirectTo="\/forgot-password"/);
  });

  it("changes the credential with Supabase's own primitive", () => {
    expect(code).toMatch(/supabase\.auth\.updateUser\(\{ password \}\)/);
    expect(code).not.toMatch(/\/api\/auth\/signup/);
    expect(code).not.toMatch(/change-password/);
    expect(code).not.toMatch(/from\("developers"\)|from\("admin_users"\)|from\("clients"\)/);
    // The legacy cleartext column stays dead.
    expect(code).not.toMatch(/password:\s*password\s*[,}]/);
  });

  it("ends the recovery session instead of promoting it to an app session", () => {
    // The app session is minted by /login (org context + membership check +
    // signed cookie). A recovery session must not be a shortcut past that.
    expect(code).toMatch(/supabase\.auth\.signOut\(\)/);
    // `?reset=1` is copy only — /login reads it to show a confirmation banner
    // and nothing else keys off it.
    expect(code).toMatch(/router\.push\("\/login\?reset=1"\)/);
    expect(code).not.toMatch(/\/api\/auth\/session/);
    expect(code).not.toMatch(/sessionStorage\.setItem/);
    expect(code).not.toMatch(/document\.cookie/);
  });
});

// ---------------------------------------------------------------------------
// 5. Password rules — stated once, identically to the existing screens
// ---------------------------------------------------------------------------

describe("evaluatePassword", () => {
  it("requires all five", () => {
    expect(evaluatePassword("Abcdef1!").isValid).toBe(true);
  });

  it("rejects each missing requirement in turn", () => {
    expect(evaluatePassword("Abc1!").requirements.minLength).toBe(false);
    expect(evaluatePassword("abcdef1!").requirements.hasUpperCase).toBe(false);
    expect(evaluatePassword("ABCDEF1!").requirements.hasLowerCase).toBe(false);
    expect(evaluatePassword("Abcdefg!").requirements.hasNumbers).toBe(false);
    expect(evaluatePassword("Abcdefg1").requirements.hasSpecialChar).toBe(false);

    for (const weak of ["Abc1!", "abcdef1!", "ABCDEF1!", "Abcdefg!", "Abcdefg1"]) {
      expect(evaluatePassword(weak).isValid, weak).toBe(false);
    }
  });

  it("tolerates a missing or non-string value", () => {
    expect(evaluatePassword(undefined).isValid).toBe(false);
    expect(evaluatePassword(null).isValid).toBe(false);
    expect(evaluatePassword(12345678).isValid).toBe(false);
  });

  it("matches the rules the registration screen already enforces", () => {
    const registration = read("src/app/admin/registration/page.js");
    // Same five keys, so <PasswordChecklist> shows the same list on every
    // screen that collects a password.
    for (const key of [
      "minLength",
      "hasUpperCase",
      "hasLowerCase",
      "hasNumbers",
      "hasSpecialChar",
    ]) {
      expect(registration, key).toContain(key);
      expect(Object.keys(evaluatePassword("x").requirements)).toContain(key);
    }
    expect(registration).toContain("password.length >= minLength");
  });
});

// ---------------------------------------------------------------------------
// 6. Nothing about WHO gets in moved
// ---------------------------------------------------------------------------

describe("authentication logic is untouched", () => {
  it("login still signs in with exactly the submitted email and password", () => {
    const source = read(LOGIN);
    expect(source).toMatch(
      /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/
    );
    // The deactivated-membership refusal, the org context load and the signed
    // session-cookie exchange are all still there, in that order.
    expect(source).toMatch(/loadOrgContext\(/);
    expect(source).toMatch(/isMembershipActive\(org\.membershipStatus\)/);
    expect(source).toMatch(/authFetch\("\/api\/auth\/session", \{ method: "POST" \}\)/);
    // And the three role branches still write the same session keys.
    for (const key of ["adminUser", "clientUser", "developerUser"]) {
      expect(source).toContain(key);
    }
  });

  it("the middleware matcher and its area rules are unchanged", () => {
    const source = read("middleware.ts");
    expect(source).toMatch(/'\/developer\/:path\*'/);
    expect(source).toMatch(/'\/admin\/:path\*'/);
    expect(source).toMatch(/'\/client\/:path\*'/);
    expect(source).toMatch(/verifySession\(raw\)/);
    expect(source).toMatch(/prefix: '\/admin', allow: \(t\) => t === 'admin'/);
  });

  it("AuthContext still decides sessions the same way", () => {
    const source = read(CONTEXT);
    expect(source).toMatch(/getStoredAdminSession\(\)/);
    expect(source).toMatch(/getStoredDeveloperSession\(\)/);
    expect(source).toMatch(/isSessionExpired\(/);
    // authStatus is derived from the existing flags — not a new decision.
    expect(source).toMatch(
      /authStatus: isLoading \? 'pending' : isLoggedIn \? 'authenticated' : 'unauthenticated'/
    );
  });

  it("the e2e hooks the auth fixtures match on are all still present", () => {
    const login = read(LOGIN);
    for (const hook of [
      "Team Member",
      "Admin",
      "Client",
      "you@example.com",
      "Enter your password",
      "Sign in as ",
    ]) {
      expect(login, hook).toContain(hook);
    }
    expect(read("src/components/auth/AuthParts.jsx")).toContain("auth-error-box");
    expect(login).toContain("<AuthError message={error} />");
  });
});
