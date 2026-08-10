/**
 * The password rules the sign-up screens already enforce, in one hook-free
 * module so the new screens state them identically instead of drifting.
 *
 * These are EXACTLY the rules in src/app/admin/registration/page.js — same five
 * requirements, same special-character class. Nothing here is new policy, and
 * nothing here is a security boundary: Supabase Auth enforces its own project
 * minimum on the server, and this only decides what the checklist shows and
 * whether we bother sending the request.
 *
 * Shaped for <PasswordChecklist requirements={…} /> in AuthParts.jsx.
 */

const SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

/**
 * @param {string} password
 * @returns {{ isValid: boolean, requirements: {
 *   minLength: boolean, hasUpperCase: boolean, hasLowerCase: boolean,
 *   hasNumbers: boolean, hasSpecialChar: boolean } }}
 */
export function evaluatePassword(password) {
  const value = typeof password === "string" ? password : "";

  const requirements = {
    minLength: value.length >= 8,
    hasUpperCase: /[A-Z]/.test(value),
    hasLowerCase: /[a-z]/.test(value),
    hasNumbers: /\d/.test(value),
    hasSpecialChar: SPECIAL.test(value),
  };

  return {
    isValid: Object.values(requirements).every(Boolean),
    requirements,
  };
}
