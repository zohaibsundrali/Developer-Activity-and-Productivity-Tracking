import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  normalizeEmail,
  newCode,
  hashCode,
  digestsEqual,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  VERIFIED_WINDOW_MINUTES,
} from "@/utils/verificationCodes";

/**
 * Signup email verification.
 *
 * The property that matters is not "the happy path works" — it is that the
 * browser can no longer decide the answer. Most of what follows therefore
 * checks the SOURCE of the registration page and the three routes, because the
 * defect being fixed was structural: a correct-looking comparison performed in
 * the wrong place.
 */

const root = path.resolve(__dirname, "..");

/**
 * Read a source file with its COMMENTS REMOVED.
 *
 * These assertions ask "does this file still do X?", and the files explain at
 * length what they used to do — quoting the old `code !== generatedCode`, the
 * old `body.code`, the old "use this code for testing" fallback. Scanning the
 * raw text finds those explanations and reports the defect as still present,
 * which is the test failing on prose rather than on behaviour.
 *
 * Stripping comments first is what makes these tests about the code.
 */
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, ""); // SQL line comments too

describe("normalizeEmail", () => {
  it("lowercases and trims, so send/verify/signup cannot disagree", () => {
    expect(normalizeEmail("  ME@Example.COM ")).toBe("me@example.com");
  });

  it("survives null and undefined rather than throwing on a bad body", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });

  it("agrees with the SQL normalisation migration 052 uses", () => {
    // 052 matches on lower(btrim(email)); btrim strips only whitespace.
    expect(normalizeEmail("\tA@B.com\n")).toBe("a@b.com");
  });
});

describe("newCode", () => {
  it("is six digits", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("never returns a value that would fail the routes' own regex", () => {
    // Both routes gate on /^\d{4,8}$/ — a leading-zero bug that produced a
    // 5-character string would be rejected as "invalid code" for a code the
    // server itself had just issued.
    for (let i = 0; i < 500; i++) expect(newCode()).toMatch(/^\d{4,8}$/);
  });

  it("varies (a constant would make every code guessable)", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(newCode());
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("hashCode", () => {
  it("is stable for the same email and code", () => {
    expect(hashCode("a@b.com", "123456")).toBe(hashCode("a@b.com", "123456"));
  });

  it("normalises the email, so casing cannot break a legitimate verify", () => {
    expect(hashCode("A@B.com", "123456")).toBe(hashCode("a@b.com", "123456"));
  });

  it("binds the address in, so one row's hash cannot be replayed at another", () => {
    expect(hashCode("a@b.com", "123456")).not.toBe(hashCode("c@d.com", "123456"));
  });

  it("differs for different codes", () => {
    expect(hashCode("a@b.com", "123456")).not.toBe(hashCode("a@b.com", "123457"));
  });

  it("does not return the code in the clear", () => {
    expect(hashCode("a@b.com", "123456")).not.toContain("123456");
  });
});

describe("digestsEqual", () => {
  it("matches identical digests", () => {
    const h = hashCode("a@b.com", "123456");
    expect(digestsEqual(h, h)).toBe(true);
  });

  it("rejects different digests", () => {
    expect(digestsEqual(hashCode("a@b.com", "1"), hashCode("a@b.com", "2"))).toBe(false);
  });

  it("rejects mismatched lengths without throwing", () => {
    // timingSafeEqual throws on unequal lengths; the length guard is what keeps
    // a malformed stored value from turning into a 500 instead of a refusal.
    expect(digestsEqual("abc", "abcd")).toBe(false);
    expect(digestsEqual("", "abcd")).toBe(false);
  });

  it("handles null and undefined", () => {
    expect(digestsEqual(null, undefined)).toBe(true); // both normalise to ""
    expect(digestsEqual(null, "x")).toBe(false);
  });
});

describe("the constants are the ones the flow depends on", () => {
  it("expires codes in ten minutes, matching what the email says", () => {
    expect(CODE_TTL_MINUTES).toBe(10);
  });

  it("caps attempts low enough that a six-digit code cannot be walked", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  it("keeps a completed verification usable for a bounded window", () => {
    expect(VERIFIED_WINDOW_MINUTES).toBeGreaterThan(CODE_TTL_MINUTES);
    expect(VERIFIED_WINDOW_MINUTES).toBeLessThanOrEqual(24 * 60);
  });
});

/* ------------------------------------------------------------------ */
/*  The structural part — where the decision is made                    */
/* ------------------------------------------------------------------ */

describe("the browser no longer decides", () => {
  const page = read("src/app/admin/registration/page.js");

  it("does not generate a code", () => {
    expect(page).not.toMatch(/Math\.random\(\)\s*\*\s*9000/);
    expect(page).not.toMatch(/setGeneratedCode\s*\(/);
  });

  it("holds no code in state to compare against", () => {
    expect(page).not.toMatch(/const \[generatedCode/);
  });

  it("does not compare the typed code locally", () => {
    expect(page).not.toMatch(/code\s*!==\s*generatedCode/);
  });

  it("asks the server instead", () => {
    expect(page).toContain("/api/auth/verify-code");
  });

  it("has no 'use this code for testing' fallback", () => {
    // The old failure path printed the code on screen and waved the user
    // through — a verification step anyone could pass by making the send fail.
    expect(page).not.toMatch(/Use this code for testing/i);
  });
});

describe("the send route mints the code rather than relaying one", () => {
  const route = read("src/app/api/send-verification/route.js");

  it("no longer reads a caller-supplied code", () => {
    expect(route).not.toMatch(/body\.code/);
  });

  it("generates and stores one", () => {
    expect(route).toContain("newCode()");
    expect(route).toContain("email_verifications");
    expect(route).toContain("hashCode(");
  });

  it("refuses to send when the code could not be stored", () => {
    // Sending a code nothing recorded is worse than not sending: the user
    // types a number that can never verify and reads it as their own mistake.
    expect(route).toContain("Could not start verification");
  });

  it("retires any previous live code for the address", () => {
    expect(route).toMatch(/is\(['"]consumed_at['"], null\)/);
  });
});

describe("signup refuses an unverified address", () => {
  const route = read("src/app/api/auth/signup/route.js");

  it("checks email_verifications", () => {
    expect(route).toContain("email_verifications");
  });

  it("consumes the verification in the same statement that checks it", () => {
    // Read-then-write would let two concurrent signups both pass.
    const idx = route.indexOf("email_verifications");
    const near = route.slice(idx - 400, idx + 600);
    expect(near).toContain("consumed_at");
    expect(near).toMatch(/\.update\(/);
  });

  it("returns a distinguishable refusal", () => {
    expect(route).toContain("email_not_verified");
  });

  it("gates before anything is created", () => {
    const gate = route.indexOf("email_not_verified");
    const firstInsert = route.indexOf('.from("admin_users")');
    expect(gate).toBeGreaterThan(-1);
    expect(firstInsert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstInsert);
  });
});

describe("the verify route does not leak signup state", () => {
  const route = read("src/app/api/auth/verify-code/route.js");

  it("gives one message for every failure mode", () => {
    // Distinguishing "never issued" from "expired" from "wrong" would turn the
    // endpoint into an oracle for which addresses are mid-signup.
    const messages = [...route.matchAll(/error:\s*"([^"]+)"/g)].map((m) => m[1]);
    const distinct = new Set(messages.filter((m) => m.toLowerCase().includes("code")));
    expect(distinct.size).toBe(1);
  });

  it("counts a wrong guess before answering", () => {
    // Anchored on the COMPARISON, not on the import of the same name — the
    // import is the first occurrence in the file and a window measured from
    // there would pass without the increment existing at all.
    const wrongIdx = route.indexOf("if (!digestsEqual(");
    expect(wrongIdx, "expected an `if (!digestsEqual(` branch").toBeGreaterThan(-1);
    const branch = route.slice(wrongIdx, wrongIdx + 500);
    expect(branch).toMatch(/attempts:\s*row\.attempts\s*\+\s*1/);
    // And the increment must be awaited before the response is returned, so a
    // client that abandons the connection still pays for the guess.
    expect(branch.indexOf("await")).toBeLessThan(branch.indexOf("return"));
  });

  it("orders the lookup, so a resend cannot return the retired row", () => {
    expect(route).toMatch(/\.order\(\s*["']created_at["']/);
  });
});

describe("migration 056 locks the table to the server", () => {
  const sql = read("database/056_email_verification.sql");

  it("enables RLS", () => {
    expect(sql).toMatch(/enable row level security/i);
  });

  it("creates no policy at all", () => {
    expect(sql).not.toMatch(/create policy/i);
  });

  it("revokes the browser roles explicitly", () => {
    expect(sql).toMatch(/revoke all on public\.email_verifications from anon, authenticated/i);
  });

  it("stores a hash, never the code", () => {
    expect(sql).toContain("code_hash");
    expect(sql).not.toMatch(/^\s*code\s+text/im);
  });
});
