import { PROJECT_ROLES } from "@/utils/roles";

/**
 * Which projects a person is on, and in what capacity.
 *
 * THE HALF OF THE ENGINE THAT HAD NO DATA. permissionEngine.js has always
 * accepted a `projectRoles` map on the subject and a `projectId` in the scope:
 *
 *     if (projectId && projectRoles) {
 *       const projectRole = own(projectRoles, projectId);
 *       if (typeof projectRole === "string" && allowed.includes(projectRole))
 *         return true;
 *     }
 *
 * Nothing ever built that map. `projectRoles` appeared nowhere in the
 * repository except that file and its own comments, and no route passed a
 * scope. Migration 071 adds the table; this module reads it.
 *
 * ── DIRECTION MATTERS, AND IT IS THE SAFE ONE ─────────────────────────────
 *
 * A project role only ever GRANTS. resolvePermission checks the org-wide role
 * as well, and returns true if either says yes. So a route that forgets to pass
 * a projectId is not a hole — it falls back to exactly the behaviour the
 * product has today. Adding project scope cannot silently widen access.
 *
 * The reverse — using project membership to RESTRICT someone who holds the
 * org-wide role — is a different and much sharper change, because it takes
 * access away from people who have it today. That is `mayActOnProject` below,
 * and it is deliberately NOT wired into every project route in one go.
 *
 * ── LOADED ON DEMAND, NOT ON EVERY REQUEST ────────────────────────────────
 *
 * getAuthedOrg already costs one query for permission overrides. Loading every
 * project membership for every request, on routes that overwhelmingly do not
 * ask a project-scoped question, would be a second one for nothing. Routes that
 * need it ask for it.
 */

/** Roles that org-wide outrank any project arrangement. */
const ORG_WIDE_OVERRIDE = Object.freeze(["owner", "admin"]);

/**
 * Read this person's role on one project, or on all of them.
 *
 * @param {object} client   a Supabase client. Pass the SERVICE client: this is
 *                          read as part of an authorization decision, and a
 *                          decision that silently returns fewer rows because
 *                          RLS filtered them is a decision made on bad data.
 * @param {{orgId: string, appUserId: string}} auth
 * @param {string|null} [projectId] one project, or null for every one
 * @returns {Promise<Record<string, string>>} `{ [projectId]: project_role }`
 */
export async function loadProjectRoles(client, auth, projectId = null) {
  const orgId = auth?.orgId;
  const appUserId = auth?.appUserId;
  // No identity means no memberships. Returning {} rather than throwing keeps
  // this the same shape as "on no projects", which is the correct answer.
  if (!client || !orgId || !appUserId) return {};

  let query = client
    .from("project_members")
    .select("project_id, project_role")
    .eq("organization_id", orgId)
    .eq("user_id", appUserId);

  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;

  // A MISSING TABLE IS NOT AN EMPTY ONE, but here both must answer the same
  // way, and that way is {}. Because project roles only ever grant, {} is the
  // strict answer: a deployment where 071 has not been run behaves exactly as
  // it does today rather than failing every project route closed.
  if (error) return {};

  const map = {};
  for (const row of data || []) {
    if (row?.project_id && typeof row.project_role === "string") {
      map[String(row.project_id)] = row.project_role;
    }
  }
  return map;
}

/**
 * This person's role on one project, or null.
 *
 * Reads own properties only — the same reason permissionEngine does. A
 * `projectRoles` object built from a JSON body would otherwise answer for
 * "constructor" and "toString".
 */
export function projectRoleFor(projectRoles, projectId) {
  if (!projectRoles || typeof projectRoles !== "object" || !projectId) return null;
  if (!Object.prototype.hasOwnProperty.call(projectRoles, String(projectId))) return null;
  const role = projectRoles[String(projectId)];
  return typeof role === "string" && PROJECT_ROLES.includes(role) ? role : null;
}

/**
 * May this person act on this project at all?
 *
 * THIS ONE RESTRICTS, which is why it is a separate function with a separate
 * name rather than a flag on the one above.
 *
 * The rule for a software house: owner and admin see the whole company by
 * definition. Everybody else — including a `manager`, whose catalogue
 * permissions are all organization-wide today — must actually be on the
 * project. A project manager owns two or three projects, not forty.
 *
 * `null` projectRoles means "not loaded", and is treated as NOT a member. The
 * caller must load them; guessing would make the answer depend on whether
 * somebody remembered to.
 */
export function mayActOnProject(auth, projectId, projectRoles) {
  if (!auth) return false;
  if (auth.userType === "client" || auth.role === "client") return false;
  if (ORG_WIDE_OVERRIDE.includes(auth.role)) return true;
  return projectRoleFor(projectRoles, projectId) !== null;
}

/**
 * `auth`, with this project's role attached, ready for requirePermission.
 *
 * A separate call rather than a flag on getAuthedOrg: overwhelmingly most
 * routes ask no project-scoped question, and every one of them would otherwise
 * pay for a second query. Routes that need it say so.
 *
 * Returns a NEW object. Mutating `auth` in place would mean the presence of
 * project roles depended on call order, and the whole point of the engine's
 * `own()` reads is that a subject is a plain, predictable value.
 */
export async function withProjectRoles(auth, client, projectId) {
  if (!auth) return auth;
  const projectRoles = await loadProjectRoles(client, auth, projectId);
  return { ...auth, projectRoles };
}
