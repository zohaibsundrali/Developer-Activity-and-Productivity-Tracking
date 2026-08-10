import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Add Developer form: the name rule, and the reason the fields were full.
 *
 * WHAT WAS WRONG
 *  Name, email and password arrived pre-filled. Nothing in the component seeds
 *  them — `newDeveloper` starts as three empty strings and only the change
 *  handler ever writes to it — so the values were the browser's: three inputs
 *  called name / email / password in that order read as a sign-up form, and the
 *  signed-in admin's own saved credentials were filled into a form whose whole
 *  job is to create SOMEONE ELSE's account. The fix is `autoComplete`, applied
 *  at the source of the fill. Blanking state in an effect would have let the
 *  admin's password appear on screen first and be re-filled on the next focus.
 *
 *  Alongside it, the name is now validated as it is typed and the message is
 *  surfaced through Field's `error` prop, which is what wires it into
 *  aria-describedby on the input.
 *
 * THE RULE, AND THE ONE JUDGEMENT CALL IN IT
 *  Letters and spaces, 3-50 characters, no digits and no symbols — plus the
 *  apostrophe and the hyphen, because O'Brien and Anne-Marie are names and a
 *  form that refuses them cannot add those developers at all. Both are allowed
 *  only BETWEEN letters, so they buy nothing for "Ali-" or "!!!".
 */

const { validateDeveloperName, NAME_MIN_LENGTH, NAME_MAX_LENGTH } = await import(
  "@/components/admin/AddDeveloper"
);

const ok = (value) => validateDeveloperName(value) === "";

describe("developer name validation", () => {
  it("accepts an ordinary name", () => {
    expect(validateDeveloperName("Ali Raza")).toBe("");
    expect(ok("Ali Raza")).toBe(true);
  });

  it("rejects digits anywhere in the name", () => {
    expect(validateDeveloperName("Ali2")).not.toBe("");
    expect(validateDeveloperName("Ali Raza 2")).not.toBe("");
    expect(validateDeveloperName("2Ali")).not.toBe("");
  });

  it("rejects symbols", () => {
    for (const bad of ["Ali@Raza", "Ali_Raza", "Ali.Raza", "<script>ali", "Ali/Raza", "Ali+Raza"]) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  it("rejects a name shorter than the minimum", () => {
    expect(validateDeveloperName("Al")).not.toBe("");
    expect(validateDeveloperName("Al")).toContain(String(NAME_MIN_LENGTH));
    expect(ok("Ali")).toBe(true);
  });

  it("rejects a name longer than the maximum", () => {
    const fifty = "a".repeat(NAME_MAX_LENGTH);
    const fiftyOne = "a".repeat(NAME_MAX_LENGTH + 1);

    expect(fiftyOne).toHaveLength(51);
    expect(ok(fifty)).toBe(true);
    expect(validateDeveloperName(fiftyOne)).not.toBe("");
    expect(validateDeveloperName(fiftyOne)).toContain(String(NAME_MAX_LENGTH));
  });

  it("measures length after trimming, so surrounding spaces do not pad a short name", () => {
    expect(ok("  Al  ")).toBe(false);
    expect(ok(`  ${"a".repeat(NAME_MAX_LENGTH)}  `)).toBe(true);
  });

  // The decision: apostrophes and hyphens are ACCEPTED. They are name-forming
  // marks, not symbols — rejecting them would reject real developers — but they
  // must sit between letters.
  it("accepts apostrophes and hyphens inside a name", () => {
    for (const good of ["O'Brien", "Anne-Marie", "Anne-Marie O'Brien", "O’Brien"]) {
      expect(ok(good), good).toBe(true);
    }
  });

  it("still rejects those marks when they are not joining two letters", () => {
    for (const bad of ["-Ali", "Ali-", "'Ali", "Ali--Raza", "Ali''Raza", "--", "'"]) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  it("accepts non-ASCII letters", () => {
    for (const good of ["José Martínez", "Müller", "Иван Петров", "李小龍 Wong"]) {
      expect(ok(good), good).toBe(true);
    }
  });

  it("treats an untouched field as not-yet-an-error", () => {
    // The field is `required`; nobody should be told off before typing.
    expect(validateDeveloperName("")).toBe("");
    expect(validateDeveloperName("   ")).toBe("");
    expect(validateDeveloperName(undefined)).toBe("");
    expect(validateDeveloperName(null)).toBe("");
  });
});

describe("the Add Developer form starts empty", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/admin/AddDeveloper.jsx"),
    "utf8"
  );

  it("seeds its state with three empty strings and nothing else", () => {
    expect(source).toMatch(
      /useState\(\{\s*name:\s*""\s*,\s*email:\s*""\s*,\s*password:\s*""\s*\}\)/
    );
  });

  it("does not blank the fields in an effect after paint", () => {
    // The wrong fix: the admin would watch their own details appear and vanish.
    expect(source).not.toMatch(/useEffect\([^)]*setNewDeveloper/s);
  });

  it("tells the browser not to autofill any of the three inputs", () => {
    // The form itself, plus each field — `off` on the two identity fields and
    // `new-password` on the credential, which is what suppresses the saved
    // password on Chrome and Safari.
    expect(source).toMatch(/<form[^>]*autoComplete="off"/);
    expect(source.match(/autoComplete="off"/g) || []).toHaveLength(3);
    expect(source).toMatch(/autoComplete="new-password"/);
  });

  it("still sends the typed password to /api/auth/provision", () => {
    // The field's initial value changed; what the form submits did not.
    expect(source).toMatch(/authFetch\("\/api\/auth\/provision"/);
    expect(source).toMatch(/password:\s*newDeveloper\.password/);
  });

  it("surfaces the name error through Field, which owns aria-describedby", () => {
    expect(source).toMatch(/error=\{nameError \|\| undefined\}/);
    expect(source).toMatch(/const nameError = validateDeveloperName\(newDeveloper\.name\)/);
  });
});
