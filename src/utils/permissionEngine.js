/**
 * The resolver. One function decides every permission question in the product.
 *
 * PURE ON PURPOSE — no session, no Supabase, no `window`, no imports beyond the
 * catalogue and the role list. That is what lets the edge middleware, a server
 * route running on a verified JWT, and a browser component all ask the same
 * question and get the same answer. The moment this file reaches for
 * sessionStorage it can no longer be imported by a route, and the split that
 * produced four copies of the rules starts again.
 *
 * THE SUBJECT
 *
 * Callers pass what they know about the person, never the person's opinion of
 * themselves:
 *
 *   { role, overrides, projectRoles }
 *
 *   role         membership role, read from the SIGNED session cookie or from a
 *                verified JWT. Never from a request body or a query string.
 *   overrides    per-user grants and denies, `{ "task.review": false }`.
 *                Optional. Nothing populates this yet — the `user_permissions`
 *                table lands in the next phase — but the resolution order is
 *                the deliverable, so it is implemented and tested here rather
 *                than bolted on later.
 *   projectRoles `{ [projectId]: role }` for project-scoped questions.
 *                Same status: order first, store next.
 *
 * RESOLUTION ORDER, and every step of it fails closed:
 *
 *   1. explicit user DENY      → refuse. A deny always wins, including over an
 *                                owner's role grant, because the only reason to
 *                                write one is to take something away from
 *                                somebody who would otherwise have it.
 *   2. explicit user ALLOW     → allow.
 *   3. project role, if scoped → the role the person holds ON THAT PROJECT.
 *   4. org role default        → the catalogue.
 *   5. nothing matched         → refuse.
 *
 * WHAT THIS REPLACED FAILED OPEN. `can()` ended in `default: return true`, so
 * every key not in its switch — including every typo — answered yes for anyone
 * signed in. `can("manage_setting")` was true for a developer. Nothing caught
 * it because nothing was checking that call sites named real keys; that is now
 * a test (tests/permissionEngine.test.js), which is what makes fail-closed safe
 * to turn on rather than a way to break five screens at once.
 */

import {
  PERMISSION_KEYS,
  defaultRolesFor,
  isPermissionKey,
} from "@/utils/permissionCatalogue";

/** Nothing known about anybody. Shared so callers need not build one. */
export const ANONYMOUS = Object.freeze({ role: null });

/**
 * Own properties only — every read of the subject goes through this.
 *
 * The inner override lookup already used `hasOwnProperty`, and its test proved
 * it, which read as if the whole subject were safe. It was not: `subject.role`,
 * `subject.overrides` and `subject.projectRoles` were plain property accesses,
 * so a polluted `Object.prototype.role = "owner"` made `resolvePermission({},
 * key)` answer true for everything, and a polluted `Object.prototype.overrides`
 * sailed through the hasOwnProperty guard because a polluted object really does
 * own its keys.
 *
 * No pollution sink is known in this codebase. The resolver should not be the
 * thing that depends on that staying true.
 */
function own(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/**
 * Does `subject` hold `key`?
 *
 * @param {{role?: string|null, overrides?: Record<string, boolean>,
 *          projectRoles?: Record<string, string>}} subject
 * @param {string} key      a permission key from the catalogue
 * @param {{projectId?: string|null}} [scope]
 * @returns {boolean}
 */
export function resolvePermission(subject, key, scope = {}) {
  // An unknown key is a bug in the caller, not a question about the person, and
  // the safe answer to a question nobody defined is no.
  if (!isPermissionKey(key)) return false;
  if (!subject || typeof subject !== "object") return false;

  const overrides = own(subject, "overrides");
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    // Present-and-false is a deny and present-and-true is a grant; anything
    // else stored in there is not an answer, so fall through rather than
    // guessing which one a truthy string was meant to be.
    const value = overrides[key];
    if (value === false) return false;
    if (value === true) return true;
  }

  const allowed = defaultRolesFor(key);

  // Project scope, when the caller asked for it. A project role can only ever
  // GRANT here — someone who already holds the permission org-wide does not
  // lose it by not being on the project, because plenty of these screens are
  // org-wide reads. Taking access away for one project is what an override is
  // for, and it is checked above this line.
  const projectId = own(scope, "projectId");
  const projectRoles = own(subject, "projectRoles");
  if (projectId && projectRoles) {
    const projectRole = own(projectRoles, projectId);
    if (typeof projectRole === "string" && allowed.includes(projectRole)) return true;
  }

  const role = own(subject, "role");
  return typeof role === "string" && allowed.includes(role);
}

/**
 * The same question for a bare role, which is what most callers actually have.
 *
 * Kept as its own export rather than making `subject` accept a string: a
 * function that takes "either a string or an object" is one where passing the
 * wrong one silently answers no, and "silently answers no" is the failure mode
 * hardest to notice in a permission system.
 */
export function roleCan(role, key, scope = {}) {
  return resolvePermission({ role }, key, scope);
}

/**
 * Every key this subject holds. For sending a permission set to the browser
 * once instead of asking N times, and for the "nobody is stranded" test.
 */
export function permissionSetFor(subject) {
  const out = [];
  for (const key of PERMISSION_KEYS) {
    if (resolvePermission(subject, key)) out.push(key);
  }
  return out;
}
