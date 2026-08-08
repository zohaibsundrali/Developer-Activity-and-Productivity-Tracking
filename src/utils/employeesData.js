import { supabase } from "@/utils/supabaseClient";
import { uploadOrgFile } from "@/utils/orgFiles";
import { getOrgId } from "@/utils/orgContext";
import { notify, dailyDedupeKey } from "@/utils/notifications";

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

/**
 * A team move changes who someone sits with and who is accountable for them, so
 * it goes to the employee and to whoever now owns them.
 *
 * The manager and the lead are two ids on the team row and one membership read
 * says how each is addressed, so the cost is two queries no matter how many
 * people the team has.
 */
async function notifyTeamAssignment(orgId, emp, teamId) {
  if (!orgId || !teamId || !emp?.userId) return;

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, manager_id, team_lead_id")
    .eq("id", teamId)
    .single();
  if (!team) return;

  // Managing the team you were just added to is not news to you, and the
  // employee already has their own, differently worded notification below.
  const leadIds = [...new Set([team.manager_id, team.team_lead_id].filter(Boolean).map(String))].filter(
    (id) => id !== String(emp.userId)
  );
  const { data: leads } = leadIds.length
    ? await supabase
        .from("memberships")
        .select("user_id, user_type, email")
        .eq("organization_id", orgId)
        .in("user_id", leadIds)
    : { data: [] };

  const teamName = team.name || "a team";
  const who = emp.name || emp.email || "A team member";
  const metadata = {
    teamId: team.id,
    teamName: team.name || null,
    employeeId: emp.userId,
    employeeName: emp.name || null,
    previousTeamId: emp.teamId || null,
    previousTeamName: emp.teamName || null,
  };
  // Per day: someone can move between teams over the course of a reorganisation
  // and each move is news, but the same save landing twice is not.
  const keyFor = (recipientId) => dailyDedupeKey(`team_assigned:${team.id}`, emp.userId, recipientId);
  const common = { category: "team", entityType: "team", entityId: team.id, metadata };

  const sends = [
    notify({
      ...common,
      audience: emp.userType === "admin" ? "admin" : "developer",
      recipientId: emp.userId,
      recipientEmail: emp.userType === "admin" ? emp.email || null : null,
      type: "team_assigned",
      title: "Added to a team",
      message: `You were added to ${teamName}.`,
      dedupeKey: keyFor(emp.userId),
    }),
  ];

  for (const l of leads || []) {
    const isAdmin = l.user_type === "admin";
    sends.push(
      notify({
        ...common,
        audience: isAdmin ? "admin" : "developer",
        recipientId: l.user_id,
        recipientEmail: isAdmin ? l.email || null : null,
        type: "team_member_added",
        title: "New team member",
        message: `${who} was added to ${teamName}.`,
        dedupeKey: keyFor(l.user_id),
      })
    );
  }

  await Promise.all(sends);
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

      // The form submits the whole membership patch every time, so `team_id`
      // being present says nothing on its own — only a different value is a
      // move. Announced from here rather than at the end of the function
      // because the move is already persisted at this point, and a later
      // profile failure must not decide whether anyone was told about it.
      const nextTeamId = membershipPatch.team_id;
      if (nextTeamId && String(nextTeamId) !== String(emp?.teamId || "")) {
        try {
          await notifyTeamAssignment(orgId || getOrgId(), emp, nextTeamId);
        } catch {
          /* the membership is saved — announcing it must not report a failure */
        }
      }
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

// Who is entitled to hear about a membership change. Suspending someone cuts
// their access (orgContext.isMembershipActive), so the people accountable for
// the org find out rather than discovering it from a locked-out colleague.
const ADMIN_ROLES = ["owner", "admin"];

async function notifyEmployeeStatus(emp, status) {
  const orgId = getOrgId();
  if (!orgId) return;

  // One query for the whole recipient list — the org can have any number of
  // owners and admins.
  const { data: recipients } = await supabase
    .from("memberships")
    .select("user_id, user_type, email")
    .eq("organization_id", orgId)
    .in("role", ADMIN_ROLES);
  if (!recipients?.length) return;

  const verb = status === "active" ? "activated" : status === "suspended" ? "suspended" : `set to ${status}`;
  const who = emp?.name || emp?.email || "A team member";
  await Promise.all(
    (recipients || []).map((r) =>
      notify({
        audience: r.user_type === "admin" ? "admin" : "developer",
        recipientId: r.user_id,
        recipientEmail: r.user_type === "admin" ? r.email || null : null,
        category: "team",
        type: "employee_status_changed",
        title: "Team member updated",
        message: `${who} was ${verb}.`,
        entityType: "employee",
        entityId: emp?.userId || null,
        // Per day: a member can be suspended and reinstated over time and each
        // of those is news, but the same click landing twice is not.
        dedupeKey: dailyDedupeKey(`employee_${status}`, emp?.userId || emp?.membershipId, r.user_id),
      })
    )
  );
}

// Just change a member's status (activate / deactivate / suspend).
export async function setEmployeeStatus(emp, status) {
  const { error } = await supabase
    .from("memberships")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", emp.membershipId);
  if (!error) {
    try {
      await notifyEmployeeStatus(emp, status);
    } catch {
      /* the status is saved — failing to announce it must not report a failure */
    }
  }
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
