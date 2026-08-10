import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderTemplate, TEMPLATE_NAMES } from "@/utils/emailTemplates";
import { validatePersonName, NAME_MIN_LENGTH, NAME_MAX_LENGTH } from "@/utils/nameValidation";
import { BRAND_NAME } from "@/components/brand/brand";

/**
 * The create-organization form and the email confirmation that follows it.
 *
 * WHAT THIS COVERS
 *  1. The name rule — one implementation, shared with the Add Developer form.
 *  2. The confirmation email: what it says, and that nothing interpolated into
 *     it can become markup.
 *  3. The verification step: four boxes, an automatic submit, a countdown, and
 *     two different messages for "wrong" and "expired".
 *  4. The two things that must NOT have changed: the terms gate on the server
 *     and what the signup POST sends.
 *
 * Where a rule is a pure function it is imported and executed. Where it lives
 * inside a client component that cannot be mounted here (no DOM environment in
 * this suite), the source is asserted instead — a weaker test, so it is used
 * only for wiring, and `formatCountdown` is lifted out of the source and run
 * for real rather than eyeballed.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");

const REGISTRATION = read("src/app/admin/registration/page.js");
const ROUTE = read("src/app/api/send-verification/route.js");
const TEMPLATES_SRC = read("src/utils/emailTemplates.js");

/** Source with block comments removed — prose about a bug is not the bug. */
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const REGISTRATION_CODE = withoutComments(REGISTRATION);
const ROUTE_CODE = withoutComments(ROUTE);

// ── 14. Full name ────────────────────────────────────────────────────

describe("full name validation on the create-organization form", () => {
  it("is the same implementation the Add Developer form uses, not a second copy", async () => {
    const { validateDeveloperName } = await import("@/components/admin/AddDeveloper");
    expect(validateDeveloperName).toBe(validatePersonName);
    // …and the form imports it rather than declaring a rule of its own.
    expect(REGISTRATION).toContain('import { validatePersonName } from "@/utils/nameValidation"');
    expect(REGISTRATION_CODE).not.toMatch(/const \w*NAME_PATTERN\s*=/);
  });

  it("accepts a name", () => {
    for (const good of ["Ali Raza", "Jo Ann", "José Martínez", "Müller", "O'Brien", "Anne-Marie"]) {
      expect(validatePersonName(good), good).toBe("");
    }
  });

  it("rejects numbers and symbols", () => {
    for (const bad of ["Ali2", "2Ali", "Ali Raza 2", "Ali@Raza", "Ali_Raza", "Ali.Raza", "<script>ali"]) {
      expect(validatePersonName(bad), bad).not.toBe("");
    }
  });

  it("holds the 3-50 bound, measured after trimming", () => {
    expect(NAME_MIN_LENGTH).toBe(3);
    expect(NAME_MAX_LENGTH).toBe(50);
    expect(validatePersonName("Al")).not.toBe("");
    expect(validatePersonName("  Al  ")).not.toBe("");
    expect(validatePersonName("Ali")).toBe("");
    expect(validatePersonName("a".repeat(50))).toBe("");
    expect(validatePersonName("a".repeat(51))).not.toBe("");
  });

  it("says nothing about a field nobody has typed in yet", () => {
    expect(validatePersonName("")).toBe("");
    expect(validatePersonName("   ")).toBe("");
    expect(validatePersonName(undefined)).toBe("");
  });

  it("runs on every keystroke, not only on submit", () => {
    // The change handler validates the name as it is typed…
    expect(REGISTRATION_CODE).toMatch(
      /if \(field === "fullName"\) \{\s*const message = validatePersonName\(sanitizedValue\);\s*setErrors/
    );
    // …and submit still catches the empty case, which the validator ignores.
    expect(REGISTRATION_CODE).toMatch(/newErrors\.fullName = "Full name is required"/);
    expect(REGISTRATION_CODE).toMatch(/const nameProblem = validatePersonName\(formData\.fullName\)/);
  });

  it("shows the message through Field, which owns aria-describedby", () => {
    expect(REGISTRATION).toMatch(/<Field label="Full name" htmlFor="reg-name" error=\{errors\.fullName\}/);
  });
});

// ── 15. The terms checkbox, client side ──────────────────────────────

describe("the terms box stops the submit in the browser", () => {
  it("records a terms problem when the box is unticked", () => {
    expect(REGISTRATION_CODE).toMatch(
      /if \(!termsAccepted\) \{\s*newErrors\.terms = "Please accept the Terms of Service to continue";/
    );
  });

  it("returns before anything is sent when there is any problem", () => {
    // No verification email, no Supabase read, no signup POST.
    expect(REGISTRATION_CODE).toMatch(
      /const problems = validateForm\(\);\s*if \(Object\.keys\(problems\)\.length > 0\) \{[\s\S]{0,160}?return;\s*\}/
    );
    const submitBody = REGISTRATION_CODE.slice(REGISTRATION_CODE.indexOf("const handleRegister"));
    const guardAt = submitBody.indexOf("const problems = validateForm()");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(submitBody.indexOf("sendVerificationCode(formData.email)")).toBeGreaterThan(guardAt);
  });

  it("says why, next to the box, and moves the caret there", () => {
    expect(REGISTRATION).toMatch(/id=\{`\$\{id\}-error`\} role="alert"/);
    expect(REGISTRATION).toContain('["terms", "reg-terms"]');
    expect(REGISTRATION_CODE).toMatch(/focusFirstProblem\(problems\)/);
  });

  it("does not weaken or duplicate the server's refusal", () => {
    // The flag is still sent, and this file still contains no check of its own
    // beyond the one above — the 400 lives in /api/auth/signup.
    expect(REGISTRATION).toMatch(/timezone:[\s\S]{0,200}?termsAccepted,/);
    expect(REGISTRATION).toContain("termsAccepted: joinTermsAccepted");
    expect(REGISTRATION_CODE).not.toMatch(/status:\s*400/);
  });
});

// ── 16. Four boxes ───────────────────────────────────────────────────

describe("the verification code is four separate boxes", () => {
  it("renders one input per digit, and no single combined field", () => {
    expect(REGISTRATION_CODE).toMatch(/const OTP_LENGTH = 4/);
    expect(REGISTRATION).toContain("digits.map((digit, index) =>");
    expect(REGISTRATION).toContain("maxLength={1}");
    // The old single field is gone.
    expect(REGISTRATION).not.toContain('placeholder="0000"');
    expect(REGISTRATION).not.toContain("tracking-[0.5em]");
  });

  it("gives every box its own accessible name", () => {
    expect(REGISTRATION).toContain(
      "aria-label={`Verification code, digit ${index + 1} of ${length}`}"
    );
  });

  it("wires the boxes into Field's error, so the message is announced on them", () => {
    expect(REGISTRATION).toContain('"aria-describedby": describedBy');
    expect(REGISTRATION).toContain("aria-describedby={describedBy}");
    expect(REGISTRATION).toContain("aria-invalid={invalid}");
    expect(REGISTRATION).toMatch(/<Field[\s\S]{0,120}error=\{codeMessage\}/);
  });

  it("spreads a pasted code across the boxes instead of dropping three digits", () => {
    expect(REGISTRATION).toContain("onPaste={handlePaste(index)}");
    expect(REGISTRATION).toMatch(
      /const pasted = \(event\.clipboardData\?\.getData\("text"\) \|\| ""\)\.replace\(\/\\D\/g, ""\)/
    );
    expect(REGISTRATION).toMatch(/writeFrom\(index, pasted\.slice\(0, length - index\)\)/);
  });

  it("moves between boxes the way a keyboard user expects", () => {
    for (const key of ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(REGISTRATION, key).toContain(`event.key === "${key}"`);
    }
    // Backspace in an empty box steps back and clears the one before it.
    expect(REGISTRATION).toMatch(/else if \(index > 0\) \{\s*next\[index - 1\] = "";/);
  });

  it("verifies automatically once the last box is filled, and only once per code", () => {
    expect(REGISTRATION_CODE).toMatch(/if \(!codeComplete \|\| verificationLoading \|\| codeExpired\) return;/);
    expect(REGISTRATION_CODE).toMatch(/if \(attemptedCode\.current === code\) return;\s*attemptedCode\.current = code;\s*verifyCodeAndRegister\(\);/);
  });

  it("gives a wrong code and an expired code different messages", () => {
    const wrong = REGISTRATION.match(/That code isn't right[^"]*/)?.[0];
    const expired = REGISTRATION.match(/That code has expired[^"]*/)?.[0];
    expect(wrong).toBeTruthy();
    expect(expired).toBeTruthy();
    expect(wrong).not.toBe(expired);
    // …and an incomplete code is a third, separate thing.
    expect(REGISTRATION).toContain("Enter all ${OTP_LENGTH} digits of the code.");
  });

  it("holds the digits positionally, so clearing one box does not shuffle the rest", () => {
    expect(REGISTRATION_CODE).toMatch(/const \[codeDigits, setCodeDigits\] = useState\(emptyDigits\)/);
    expect(REGISTRATION_CODE).toMatch(/const code = codeDigits\.join\(""\)/);
    expect(REGISTRATION_CODE).toMatch(/const codeComplete = codeDigits\.every\(\(digit\) => digit !== ""\)/);
  });
});

// ── 17. Expiry and the countdown ─────────────────────────────────────

describe("the ten-minute countdown", () => {
  // Lifted out of the page and executed, so this is the shipped function.
  const source = REGISTRATION.match(/function formatCountdown\(ms\) \{[\s\S]*?\n\}/)[0];
  const formatCountdown = new Function(`${source}; return formatCountdown;`)();

  it("counts down in m:ss", () => {
    expect(formatCountdown(10 * 60 * 1000)).toBe("10:00");
    expect(formatCountdown(9 * 60 * 1000 + 5000)).toBe("9:05");
    expect(formatCountdown(59_000)).toBe("0:59");
    expect(formatCountdown(1000)).toBe("0:01");
  });

  it("never shows a negative time", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
  });

  it("uses one lifetime, and it is the one the email states", () => {
    expect(REGISTRATION_CODE).toMatch(/const CODE_TTL_MINUTES = 10/);
    expect(REGISTRATION_CODE).toMatch(/const CODE_TTL_MS = CODE_TTL_MINUTES \* 60 \* 1000/);
    expect(REGISTRATION_CODE).toMatch(/setCodeExpiry\(Date\.now\(\) \+ CODE_TTL_MS\)/);
    expect(ROUTE_CODE).toMatch(/const CODE_TTL_MINUTES = 10/);
    expect(ROUTE_CODE).toMatch(/expiresInMinutes: CODE_TTL_MINUTES/);
  });

  it("stops ticking once the code is dead rather than re-rendering for ever", () => {
    expect(REGISTRATION_CODE).toMatch(/if \(now >= codeExpiry\) clearInterval\(timer\)/);
    expect(REGISTRATION_CODE).toMatch(/return \(\) => clearInterval\(timer\)/);
  });

  it("blocks the expired code in the handler, not only in the display", () => {
    expect(REGISTRATION_CODE).toMatch(/if \(!codeExpiry \|\| Date\.now\(\) > codeExpiry\)/);
    expect(REGISTRATION_CODE).toMatch(/disabled=\{verificationLoading \|\| codeExpired\}/);
  });

  it("does not recite the seconds to a screen reader", () => {
    expect(REGISTRATION).toContain('role="timer" aria-live="off"');
  });

  // The honest part. Nothing server-side mints, stores or compares the code,
  // so this deadline is enforced in the browser and nowhere else. If that ever
  // changes, this test should be the thing that fails.
  it("is still a client-side code, compared client-side", () => {
    expect(REGISTRATION_CODE).toMatch(/Math\.floor\(1000 \+ Math\.random\(\) \* 9000\)/);
    expect(REGISTRATION_CODE).toMatch(/if \(code !== generatedCode\)/);
    expect(ROUTE_CODE).not.toMatch(/Math\.random/);
    expect(ROUTE_CODE).not.toMatch(/expires_at/);
    expect(ROUTE).toContain("STILL OUTSTANDING");
  });
});

// ── 18. The email ────────────────────────────────────────────────────

describe("the verification email", () => {
  const render = (data = {}) =>
    renderTemplate("email_verification", {
      userName: "Ali Raza",
      orgName: "Acme Ltd",
      email: "ali@example.com",
      code: "4821",
      expiresInMinutes: 10,
      ...data,
    });

  it("is a template in the shared module, sent by the route", () => {
    expect(TEMPLATE_NAMES).toContain("email_verification");
    expect(ROUTE).toContain("renderTemplate('email_verification'");
    expect(ROUTE).toContain("template: 'email_verification'");
    // The route no longer builds markup of its own.
    expect(ROUTE).not.toContain("<div style=");
    expect(ROUTE).not.toContain("#009578");
  });

  it("never calls itself a login", () => {
    const { subject, html, text } = render();
    for (const part of [subject, html, text]) {
      expect(part).not.toMatch(/login/i);
      expect(part).not.toMatch(/sign in/i);
    }
    // …and the phrase is gone from the codebase's email path entirely.
    expect(ROUTE).not.toMatch(/Login Verification/i);
    expect(TEMPLATES_SRC).not.toMatch(/Login Verification/i);
  });

  it("says what it is: confirming an email address", () => {
    const { html, text } = render();
    expect(html).toContain("Confirm your email address");
    expect(text.toLowerCase()).toContain("confirm");
    expect(html).toMatch(/is not a sign-?in|not a sign-in/i);
  });

  it("names the product, from the brand module and never as a literal", () => {
    const { subject, html, text } = render();
    expect(subject).toContain(BRAND_NAME);
    expect(html).toContain(BRAND_NAME);
    expect(text).toContain(BRAND_NAME);
    // One rename, one line: the string is never typed into this module.
    expect(TEMPLATES_SRC).not.toContain(`"${BRAND_NAME}"`);
    expect(TEMPLATES_SRC).toContain('import { BRAND_NAME } from "@/components/brand/brand"');
  });

  it("states the code", () => {
    const { subject, html, text } = render({ code: "4821" });
    expect(subject).toContain("4821");
    expect(html).toContain("4821");
    expect(text).toContain("4821");
  });

  it("states that it expires in ten minutes", () => {
    const { html, text } = render();
    expect(html).toContain("expires 10 minutes after this email was sent");
    expect(text).toContain("10 minutes");
    // The lifetime is a parameter, not a second hardcoded number.
    expect(render({ expiresInMinutes: 15 }).html).toContain("expires 15 minutes");
    // …with a sane default when the caller forgets.
    expect(render({ expiresInMinutes: undefined }).html).toContain("expires 10 minutes");
  });

  it("says what to do if they did not request it", () => {
    const { html, text } = render();
    for (const part of [html, text]) {
      expect(part).toMatch(/did not request this/i);
      expect(part).toMatch(/no account is created until the code is entered/i);
      expect(part).toMatch(/never ask you for it/i);
    }
  });

  it("carries no link to click", () => {
    // A "confirm" button in a mail like this teaches people to click links in
    // mail like this. The code is typed into the tab they already have open.
    expect(render().html).not.toContain("<a href");
  });

  it("uses the shared layout, so it looks like the other templates", () => {
    const { html } = render();
    const invitation = renderTemplate("invitation", { orgName: "Acme", inviteUrl: "https://a.test/x" }).html;
    for (const marker of [
      '<table role="presentation"',
      'style="background:#f5f6f8;padding:24px 0;',
      "border-top:1px solid",
    ]) {
      expect(html, marker).toContain(marker);
      expect(invitation, marker).toContain(marker);
    }
  });

  it("escapes everything interpolated — a name is never markup", () => {
    const payload = '"><script>alert(document.cookie)</script>';
    const { html, subject } = render({
      userName: payload,
      orgName: payload,
      email: payload,
      code: payload,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(payload);
    expect(html).toContain("&lt;script&gt;");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("cannot be talked into rendering a code that is not a code", () => {
    // The code is the one value placed outside a paragraph, so it is filtered
    // to alphanumerics as well as escaped.
    const { html } = render({ code: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<[a-z]+[^>]*onerror/i);
  });

  it("survives being called with nothing at all", () => {
    const { subject, html, text } = renderTemplate("email_verification", {});
    expect(subject).toBeTruthy();
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).toContain("Confirm your email address");
    expect(text).toBeTruthy();
  });
});

// ── The hard limits ──────────────────────────────────────────────────

describe("what must not have changed", () => {
  it("the send-verification route still validates and rate limits exactly as before", () => {
    expect(ROUTE_CODE).toContain("/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(rawEmail)");
    expect(ROUTE_CODE).toMatch(/if \(!\/\^\\d\{4,8\}\$\/\.test\(rawCode\)\)/);
    expect(ROUTE_CODE).toMatch(/rateLimited\(`ip:\$\{ip\}`\) \|\| rateLimited\(`to:\$\{rawEmail\.toLowerCase\(\)\}`\)/);
    expect(ROUTE_CODE).toMatch(/status: 429/);
    // No caller-chosen content survives: `type` and `role` are not read at all.
    expect(ROUTE_CODE).not.toMatch(/body\.type|body\.role/);
  });

  it("the signup POST is untouched", () => {
    expect(REGISTRATION).toContain('await fetch("/api/auth/signup"');
    for (const field of ["fullName", "company", "industry", "companySize", "country", "email", "password", "timezone", "termsAccepted"]) {
      expect(REGISTRATION, field).toMatch(new RegExp(`${field}[,:]`));
    }
  });

  it("uses the shared alert helpers rather than a second sweetalert pattern", () => {
    expect(REGISTRATION).toContain('from "@/utils/alerts"');
    expect(REGISTRATION).not.toContain("sweetalert2");
    expect(REGISTRATION).not.toMatch(/Swal\./);
  });

  it("keeps the page on design tokens — no literal colours", () => {
    expect(REGISTRATION).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(REGISTRATION).not.toMatch(/\bbg-white\b|\btext-gray-\d|\bbg-gray-\d/);
  });
});
