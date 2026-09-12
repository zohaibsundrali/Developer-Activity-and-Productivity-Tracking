import { getOrgContext } from "@/utils/orgContext";
import { supabase } from "@/utils/supabaseClient";
import { authFetch } from "@/utils/authFetch";
import { validatePersonName } from "@/utils/nameValidation";
import { userTypeForRole } from "@/utils/roles";

/**
 * Creating a staff account outright — profile row, membership, login.
 *
 * This used to live inside src/components/admin/AddDeveloper.jsx, which was its
 * own sidebar screen. The screen is gone (the form now opens from Employees),
 * but the sequence below is not a detail of that screen: it is three writes
 * across two systems that have to be undone in the right order when the third
 * one fails. It moved here whole rather than being retyped into the dialog,
 * because a second copy of it is how the two would come to disagree about what
 * a failed provision leaves behind.
 *
 * The profile is saved first, then /api/auth/provision reserves a stable Auth
 * identity and finalizes the checked link and active membership together.
 * Uncertain failures preserve the profile; submitting the same details retries
 * the reservation instead of deleting rows underneath a pending provider call.
 *
 * WHAT DOES NOT GET WRITTEN: the password. `developers.password` is a legacy
 * plaintext column that RLS exposes to every authenticated member of the
 * organization, and the login path that once read it has been deleted. The
 * typed password's one destination is the provision route, which hands it to
 * Supabase Auth to be stored hashed.
 *
 * PERMISSION IS NOT CHECKED HERE. The provision route checks it, against the
 * caller's verified token: it requires a people-ops role and refuses to grant
 * a role ranking at or above the caller's own. `grantableStaffRoles()` shapes
 * the dropdown to match, but shaping a dropdown is not enforcement.
 */

/** Matches the `minLength` on the password field, and the route's own floor. */
export const MIN_PASSWORD_LENGTH = 6;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns the first thing wrong with the form, as a sentence, or null.
 * Re-checked on the server; this exists so the answer arrives before a round
 * trip rather than instead of one.
 */
export function validateStaffMember({ name, email, password, role }) {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim();

  if (!cleanName || !cleanEmail || !password) {
    return "A name, an email address and a password are all needed.";
  }
  // validatePersonName treats an untouched field as not-yet-an-error and
  // returns "", so the emptiness check above has to come first.
  const nameProblem = validatePersonName(cleanName);
  if (nameProblem) return nameProblem;

  if (!EMAIL_PATTERN.test(cleanEmail)) {
    return "That does not look like an email address.";
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!role) return "Pick a role for this person.";
  if (userTypeForRole(role) !== "developer") {
    // owner/admin belong in admin_users and client in clients; neither is
    // created here, and writing either into `developers` would produce a
    // membership pointing at a profile row in the wrong table.
    return "That role cannot be created from this screen.";
  }
  return null;
}

/**
 * Create one staff member.
 *
 * Returns `{ error, code, developer }` rather than throwing — every caller has
 * to tell the difference between "the plan is full" (a thing the admin can act
 * on) and "it broke", and an exception type is a poor way to carry that.
 *
 *   code: null | "validation" | "duplicate" | "plan_limit" | "failed"
 */
export async function createStaffMember({ orgId, actor, name, email, password, role }) {
  const problem = validateStaffMember({ name, email, password, role });
  if (problem) return { error: problem, code: "validation", developer: null };

  if (!orgId) {
    return {
      error: "Your session has no organization. Sign in again.",
      code: "failed",
      developer: null,
    };
  }

  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim();

  // Reuse the same saved profile on retry. The server alone decides whether
  // its reserved Auth identity can be completed; never adopt an account by email.
  let created = null;
  try {
    const { data: existing, error } = await supabase.from("developers")
      .select("id, name, email, organization_id")
      .eq("organization_id", orgId).ilike("email", cleanEmail);
    if (error) return { error: "Could not check saved profiles. Please retry.", code: "failed", developer: null };
    if ((existing || []).length > 1) return { error: "Multiple profiles use this address. Administrator review is required.", code: "duplicate", developer: null };
    created = existing?.[0] || null;
  } catch { return { error: "Could not check saved profiles. Please retry.", code: "failed", developer: null }; }

  // No `password` field. See the note at the top of this file.
  const profile = {
    name: cleanName,
    email: cleanEmail,
    status: "active",
    projects_count: 0,
    company: actor?.company || "Unknown Company",
    organization_id: orgId,
    created_at: new Date().toISOString(),
  };

  // Who added them. Older installs may not have these columns, so a failure
  // mentioning them is retried without — losing the attribution rather than
  // the person.
  const attributed = {
    ...profile,
    added_by: actor?.id ?? null,
    added_by_admin: actor?.email ?? null,
    added_by_name: actor?.name || "Admin",
  };

  if (!created) try {
    const { data, error } = await supabase.from("developers").insert([attributed]).select();
    if (error) {
      if (/added_by|schema cache/i.test(error.message || "")) {
        const { data: retry, error: retryErr } = await supabase
          .from("developers")
          .insert([profile])
          .select();
        if (retryErr) throw retryErr;
        created = Array.isArray(retry) ? retry[0] : retry;
      } else {
        throw error;
      }
    } else {
      created = Array.isArray(data) ? data[0] : data;
    }
  } catch (err) {
    return {
      error: err?.message || "The profile could not be saved.",
      code: "failed",
      developer: null,
    };
  }

  if (!created?.id) {
    return { error: "The profile was not saved.", code: "failed", developer: null };
  }

  // Membership and the reserved Auth link are finalized atomically by the
  // server. Preserve this profile across uncertain provider/network outcomes.

  // authFetch attaches the caller's Bearer token; the route derives the
  // organization from that token and refuses a role at or above the caller's.
  //
  // It RESOLVES on a 4xx rather than throwing, so the response has to be
  // inspected. Treating this call as best-effort is what once let a plan limit
  // (402) be reported to the admin as success.
  let res = null;
  let thrown = null;
  try {
    res = await authFetch("/api/auth/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: created.email,
        password,
        role,
        userType: userTypeForRole(role),
        appUserId: created.id,
      }),
    });
  } catch (err) {
    thrown = err;
  }

  if (thrown || !res?.ok) {
    const payload = res ? await res.json().catch(() => null) : null;


    if (res?.status === 402) {
      return {
        error:
          payload?.detail ||
          payload?.error ||
          "Your plan has no seat left. The profile is saved; upgrade and retry the same details.",
        code: "plan_limit",
        developer: null,
      };
    }
    return {
      error:
        payload?.error ||
        thrown?.message ||
        "Sign-in setup is incomplete. The profile is saved; retry the same email and role.",
      code: "failed",
      developer: null,
    };
  }

  const provisioned = await res.json().catch(() => null);
  if (!provisioned?.success || !provisioned.userId) return {
    error: "Sign-in completion could not be verified. The profile is saved; retry the same details.", code: "failed", developer: null,
  };
  if (provisioned.alreadyExists) return {
    error: "This account is already linked. Its password was not changed; use password recovery if needed.", code: "duplicate", developer: created,
  };

  // Best effort from here down: the account works, and failing to announce it
  // must not be reported as the add having failed.
  try {
    const context = getOrgContext();
    if (!context?.userId || context.organizationId !== orgId || !['admin', 'developer'].includes(context.userType)) {
      return { error: null, code: null, developer: created, passwordUnchanged: provisioned.passwordUnchanged };
    }
    await supabase.from("notifications").insert([
      {
        organization_id: orgId,
        ...(context.userType === 'admin'
          ? { admin_id: context.userId, admin_recipient_type: 'admin' }
          : { developer_id: context.userId }),
        message: `New ${String(role).replace(/_/g, " ")} "${cleanName}" added successfully`,
        type: "success",
        created_at: new Date().toISOString(),
      },
    ]);
  } catch {
    /* nobody is worse off for a missing notification row */
  }

  return { error: null, code: null, developer: created, passwordUnchanged: provisioned.passwordUnchanged };
}
