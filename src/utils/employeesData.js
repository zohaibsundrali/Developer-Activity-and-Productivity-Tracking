import { supabase } from "@/utils/supabaseClient";
import { uploadOrgFile } from "@/utils/orgFiles";

/**
 * Employee data access for the Team & Employee Management module.
 *
 * The org's "employees" = all non-client memberships, stitched with their
 * profile row (developers/admin_users), rich profile (employee_profiles), and
 * team/department. Uses the logged-in admin's JWT — RLS permits non-clients to
 * read org data, and denies clients entirely. Everything is scoped by orgId.
 */

// Returns { employees, teams, departments } for one organization.
export async function loadEmployees(orgId) {
  if (!orgId) return { employees: [], teams: [], departments: [] };

  const [
    { data: mem },
    { data: devs },
    { data: admins },
    { data: profiles },
    { data: teams },
    { data: depts },
  ] = await Promise.all([
    supabase.from("memberships").select("*").eq("organization_id", orgId).neq("user_type", "client"),
    supabase.from("developers").select("id, name, email, status, created_at").eq("organization_id", orgId),
    supabase.from("admin_users").select("id, full_name, email, created_at").eq("organization_id", orgId),
    supabase.from("employee_profiles").select("*").eq("organization_id", orgId),
    supabase.from("teams").select("id, name, department_id, manager_id, team_lead_id").eq("organization_id", orgId),
    supabase.from("departments").select("id, name").eq("organization_id", orgId),
  ]);

  const devById = new Map((devs || []).map((d) => [d.id, d]));
  const adminById = new Map((admins || []).map((a) => [a.id, a]));
  const teamById = new Map((teams || []).map((t) => [t.id, t]));
  const deptById = new Map((depts || []).map((d) => [d.id, d]));
  const profByKey = new Map((profiles || []).map((p) => [`${p.user_id}:${p.user_type}`, p]));

  const employees = (mem || []).map((m) => {
    const prof = profByKey.get(`${m.user_id}:${m.user_type}`) || null;
    const person = m.user_type === "admin" ? adminById.get(m.user_id) : devById.get(m.user_id);
    const name =
      person?.full_name || person?.name || (m.email ? m.email.split("@")[0] : "Member");
    return {
      membershipId: m.id,
      userId: m.user_id,
      userType: m.user_type,
      name,
      email: person?.email || m.email || "",
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

// Update a member's org fields (role/team/department/reports_to/status) and
// upsert their rich profile. Pass only the patches you want to change.
export async function saveEmployee({ orgId, emp, membershipPatch, profilePatch }) {
  try {
    if (membershipPatch && Object.keys(membershipPatch).length) {
      const { error } = await supabase
        .from("memberships")
        .update({ ...membershipPatch, updated_at: new Date().toISOString() })
        .eq("id", emp.membershipId);
      if (error) return { error };
    }

    if (profilePatch && Object.keys(profilePatch).length) {
      const row = {
        organization_id: orgId,
        membership_id: emp.membershipId,
        user_id: emp.userId,
        user_type: emp.userType,
        ...profilePatch,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("employee_profiles")
        .upsert(row, { onConflict: "organization_id,user_id,user_type" });
      if (error) return { error };
    }

    return { error: null };
  } catch (error) {
    return { error };
  }
}

// Just change a member's status (activate / deactivate / suspend).
export async function setEmployeeStatus(emp, status) {
  const { error } = await supabase
    .from("memberships")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", emp.membershipId);
  return { error };
}

// Upload an employee photo to the PRIVATE `org-files` bucket and return its
// storage path. Photos are PII, so they are no longer written to the public
// bucket where any URL holder could fetch them. Callers persist the returned
// path in employee_profiles.photo_url; render it via resolveOrgFileUrl, which
// still passes through the full URLs stored before this change.
export async function uploadEmployeePhoto(orgId, userId, file) {
  return uploadOrgFile({ orgId, category: "employee-photos", subPath: String(userId || "unassigned"), file });
}
