import { supabase } from "@/utils/supabaseClient";
import { uploadOrgFile } from "@/utils/orgFiles";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";

/**
 * Employee data access for the Team & Employee Management module.
 *
 * The org's "employees" = all non-client memberships, stitched with their
 * profile row (developers/admin_users), rich profile (employee_profiles), and
 * team/department. Uses the logged-in admin's JWT — RLS permits non-clients to
 * read org data, and denies clients entirely. Everything is scoped by orgId.
 */

// Returns { employees, teams, departments } for one organization.
export async function loadEmployees(orgId, client = supabase) {
  if (!orgId) return { employees: [], teams: [], departments: [] };

  const results = await Promise.all([
    client.from("memberships").select("*").eq("organization_id", orgId).neq("user_type", "client"),
    client.from("developers").select("id, name, email, status, created_at").eq("organization_id", orgId),
    client.from("admin_users").select("id, full_name, email, created_at").eq("organization_id", orgId),
    client.from("employee_profiles").select("*").eq("organization_id", orgId),
    client.from("teams").select("id, name, department_id, manager_id, team_lead_id").eq("organization_id", orgId),
    client.from("departments").select("id, name").eq("organization_id", orgId),
    // How many projects each person is on. Fetched as one column for the whole
    // organization and counted below, rather than a count query per employee —
    // the developer list this replaced issued N of those, so a directory of
    // forty people cost forty round trips to fill in one number.
    client
      .from("projects")
      .select("assigned_developer_email")
      .eq("organization_id", orgId),
  ]);
  if (results.some(result => result.error || !Array.isArray(result.data))) {
    throw new Error("Employee directory is temporarily unavailable");
  }
  const [mem, devs, admins, profiles, teams, depts, projectRows] = results.map(result => result.data);

  const devById = new Map((devs || []).map((d) => [d.id, d]));
  const adminById = new Map((admins || []).map((a) => [a.id, a]));
  const teamById = new Map((teams || []).map((t) => [t.id, t]));
  const deptById = new Map((depts || []).map((d) => [d.id, d]));
  const profByKey = new Map((profiles || []).map((p) => [`${p.user_id}:${p.user_type}`, p]));

  // Keyed on the lowercased address: `assigned_developer_email` is free text
  // written by several screens, so "Ali@x.com" and "ali@x.com" are one person
  // and counting them separately would show a project owner as unassigned.
  const projectsByEmail = new Map();
  (projectRows || []).forEach((p) => {
    const key = String(p?.assigned_developer_email || "").trim().toLowerCase();
    if (!key) return;
    projectsByEmail.set(key, (projectsByEmail.get(key) || 0) + 1);
  });

  const employees = (mem || []).map((m) => {
    const prof = profByKey.get(`${m.user_id}:${m.user_type}`) || null;
    const person = m.user_type === "admin" ? adminById.get(m.user_id) : devById.get(m.user_id);
    const name =
      person?.full_name || person?.name || (m.email ? m.email.split("@")[0] : "Member");
    const email = person?.email || m.email || "";
    return {
      membershipId: m.id,
      userId: m.user_id,
      userType: m.user_type,
      name,
      email,
      projectCount: projectsByEmail.get(email.trim().toLowerCase()) || 0,
      role: m.role || m.user_type || "developer",
      status: m.status || "active",
      teamId: m.team_id || null,
      teamName: m.team_id ? teamById.get(m.team_id)?.name || null : null,
      departmentId: m.department_id || null,
      departmentName: m.department_id ? deptById.get(m.department_id)?.name || null : null,
      reportsTo: m.reports_to || null, // another employee's userId
      joinedAt: person?.created_at || null,
      profile: prof, // employee_profiles row or null
    };
  });

  return { employees, teams: teams || [], departments: depts || [] };
}

/**
 * Reporting hierarchy: `memberships.reports_to` holds another member's
 * user_id, and nothing about a uuid column stops it closing a loop — A reports
 * to B while B reports to A, or a longer A→B→C→A, or the degenerate A→A. Any
 * walk up the chain (an org chart, an approval ladder, "notify my manager")
 * then never terminates.
 *
 * Migration 037 is the enforcement: a BEFORE INSERT OR UPDATE trigger on
 * memberships refuses the write, and it catches every writer including
 * OrganizationManagement.jsx, which patches memberships straight from the
 * browser. What the trigger cannot do is explain itself — it surfaces as a
 * Postgres check violation. This function is the explanation, computed from
 * the directory the caller already loaded, so the person gets a sentence with
 * names in it instead of an error code.
 *
 * Same bound as the trigger, for the same reason: if a cycle already exists in
 * the data, walking it without a limit hangs the tab.
 */
export const MAX_REPORTING_DEPTH = 64;

/**
 * Returns a human-readable reason `userId` may not report to `reportsTo`, or
 * null if the line is legal.
 *
 * `employees` is the loadEmployees() shape ({ userId, reportsTo, name, email }).
 * Rows missing from it simply end the walk early — this check is allowed to be
 * incomplete, because 037 is the one that must not be.
 */
export function reportingCycleError({ employees, userId, reportsTo }) {
  if (!userId || !reportsTo) return null;

  const me = String(userId);
  const target = String(reportsTo);
  const list = Array.isArray(employees) ? employees : [];
  const nameOf = new Map(list.map((e) => [String(e.userId), e.name || e.email || String(e.userId)]));
  const parentOf = new Map(
    list.map((e) => [String(e.userId), e.reportsTo ? String(e.reportsTo) : null])
  );
  const label = (id) => nameOf.get(id) || id;
  const meName = label(me);

  if (target === me) {
    return `${meName} cannot report to themselves.`;
  }

  // Walk up from the PROPOSED manager. The row being edited is never followed
  // — we stop the moment we reach it — so the stale reports_to still sitting in
  // `employees` for that row cannot mislead the walk.
  const chain = [];
  let cursor = target;
  let hops = 0;
  while (cursor) {
    if (cursor === me) {
      const via =
        chain.length > 1 ? ` (${chain.join(" reports to ")} reports to ${meName})` : "";
      return `That would create a reporting loop: ${label(target)} already reports to ${meName}${
        chain.length > 1 ? " indirectly" : ""
      }${via}. Pick a different manager, or clear ${label(target)}'s manager first.`;
    }
    hops += 1;
    if (hops > MAX_REPORTING_DEPTH) {
      return `The reporting chain above ${meName} is more than ${MAX_REPORTING_DEPTH} levels deep, or already contains a loop. Fix the existing chain before changing this line.`;
    }
    chain.push(label(cursor));
    const next = parentOf.get(cursor);
    cursor = next ? String(next) : null;
  }

  return null;
}

/**
 * A role change is the ONE membership field the browser may not write.
 *
 * `memberships.role` is only half of a member's role: RLS reads the other half
 * out of the JWT (app_metadata.role, via public.auth_role() — migration 018),
 * and the browser cannot touch that. Writing the row alone produced a demotion
 * that never took effect and a promotion that unlocked the UI but failed every
 * write. /api/admin/members/role writes both, in the safe order, after checking
 * the caller against the verified token.
 *
 * Returns the same { error } shape as the direct patch it replaces.
 */
async function changeMemberRole(membershipId, role) {
  try {
    const res = await authFetch("/api/admin/members/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      return {
        error: {
          message: data?.error || "Could not change the role.",
          code: "role_change_failed",
        },
      };
    }
    return { error: null };
  } catch (err) {
    return {
      error: {
        message: err?.message || "Could not change the role.",
        code: "role_change_failed",
      },
    };
  }
}

// Update a member's org fields (role/team/department/reports_to/status) and
// upsert their rich profile. Pass only the patches you want to change.
//
// `employees` is optional and used only for the readable cycle message above;
// omit it and the write still goes to the database, which refuses cycles on
// its own.
export async function saveEmployee({ orgId, emp, membershipPatch = {}, profilePatch = {}, employees }) {
  let roleChanged = false;
  try {
    const { role: nextRole, ...directPatch } = membershipPatch || {};
    if (directPatch.reports_to) {
      const message = reportingCycleError({ employees, userId: emp?.userId, reportsTo: directPatch.reports_to });
      if (message) return { error: { message, code: "reporting_cycle" } };
    }
    if (!orgId || !emp?.membershipId || !emp?.userId || !["admin", "developer"].includes(emp?.userType)) {
      return { error: { message: "Select a valid employee and organization before saving." } };
    }
    if (nextRole && String(nextRole) !== String(emp?.role || "")) {
      const { error } = await changeMemberRole(emp.membershipId, nextRole);
      if (error) return { error };
      roleChanged = true;
    }
    const { data, error } = await supabase.rpc("save_employee_record", {
      p_org: orgId, p_membership: emp.membershipId, p_user: emp.userId, p_type: emp.userType,
      p_membership_patch: directPatch, p_profile_patch: profilePatch || {},
    });
    if (error) throw error;
    if (!data?.success || data.membershipId !== emp.membershipId || data.userId !== emp.userId || data.userType !== emp.userType) {
      throw new Error("The employee save was not confirmed. Reload the directory before retrying.");
    }
    return { error: null };
  } catch (error) {
    return { error: roleChanged ? { ...error, message: `The role was changed, but the employee details were not confirmed saved. Reload before retrying. ${error?.message || ""}` } : error };
  }
}

// Uses the same atomic workflow as the profile editor.
export async function setEmployeeStatus(emp, status) {
  return saveEmployee({ orgId: getOrgId(), emp, membershipPatch: { status } });
}

// Upload an employee photo to the PRIVATE `org-files` bucket and return its
// storage path. Photos are PII, so they are no longer written to the public
// bucket where any URL holder could fetch them. Callers persist the returned
// path in employee_profiles.photo_url; render it via resolveOrgFileUrl, which
// still passes through the full URLs stored before this change.
export async function uploadEmployeePhoto(orgId, userId, file) {
  return uploadOrgFile({ orgId, category: "employee-photos", subPath: String(userId || "unassigned"), file });
}

/**
 * The ladder above one person: their manager, that manager's manager, and so
 * on, as rows from `employees`. The counterpart of `reportingCycleError` —
 * that one refuses to CREATE a loop, this one survives READING one, which
 * matters because a directory loaded mid-edit can hold a stale row.
 *
 * Stops at the top, at a manager who is not in the list, at the first person
 * seen twice, or at `limit` — whichever comes first. Never throws, never
 * hangs.
 */
export function reportingChain(employees, userId, limit = 16) {
  const list = Array.isArray(employees) ? employees : [];
  const byId = new Map(list.map((e) => [String(e.userId), e]));
  const seen = new Set([String(userId)]);
  const out = [];
  let cursor = byId.get(String(userId))?.reportsTo;
  while (cursor && out.length < limit) {
    const id = String(cursor);
    if (seen.has(id)) break;
    const next = byId.get(id);
    if (!next) break;
    seen.add(id);
    out.push(next);
    cursor = next.reportsTo;
  }
  return out;
}
