"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import StatCard from "@/components/shell/StatCard";
import {
  Users,
  RefreshCw,
  FolderKanban,
  UserCircle,
  ShieldCheck,
} from "lucide-react";

/**
 * Manager-only Team panel (staff dashboard).
 *
 * Read-only oversight for a Manager: the organization's team roster (from
 * `memberships`, scoped to the manager's org) plus a read-only view of the
 * org's projects. Purpose-built and org-scoped via getOrgId() — it does NOT
 * depend on an admin session, so it works for a manager who signs in through
 * the staff (developer) login. All queries filter by organization_id, so a
 * manager only ever sees their own organization's data.
 */

const ROLE_TONE = {
  owner: "bg-violet-500/10 text-violet-600",
  admin: "bg-primary/10 text-primary",
  manager: "bg-info/10 text-info",
  developer: "bg-success/10 text-success",
  employee: "bg-muted text-muted-foreground",
  client: "bg-warning/10 text-warning",
};

function pretty(role) {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function TeamPanel() {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const orgId = getOrgId();
      if (!orgId) {
        setError("No organization context found for your account.");
        setMembers([]);
        setProjects([]);
        return;
      }

      // Team members for this org (exclude clients — they are not staff).
      const { data: memberRows } = await supabase
        .from("memberships")
        .select("id, user_id, user_type, email, role, team_id, department_id, status")
        .eq("organization_id", orgId)
        .neq("user_type", "client");

      // Name lookups: developers + admins in this org.
      const [{ data: devs }, { data: admins }, { data: teams }, { data: depts }] =
        await Promise.all([
          supabase.from("developers").select("id, name, email").eq("organization_id", orgId),
          supabase.from("admin_users").select("id, full_name, email").eq("organization_id", orgId),
          supabase.from("teams").select("id, name").eq("organization_id", orgId),
          supabase.from("departments").select("id, name").eq("organization_id", orgId),
        ]);

      const devById = new Map((devs || []).map((d) => [d.id, d]));
      const adminById = new Map((admins || []).map((a) => [a.id, a]));
      const teamById = new Map((teams || []).map((t) => [t.id, t.name]));
      const deptById = new Map((depts || []).map((d) => [d.id, d.name]));

      const resolved = (memberRows || []).map((m) => {
        const profile =
          m.user_type === "admin" ? adminById.get(m.user_id) : devById.get(m.user_id);
        const name =
          profile?.full_name || profile?.name || (m.email ? m.email.split("@")[0] : "Member");
        return {
          id: m.id,
          name,
          email: profile?.email || m.email || "",
          role: m.role || m.user_type || "developer",
          status: m.status || "active",
          team: m.team_id ? teamById.get(m.team_id) || null : null,
          department: m.department_id ? deptById.get(m.department_id) || null : null,
        };
      });

      // Sort by role rank (owner→employee) then name.
      const rank = { owner: 6, admin: 5, manager: 4, developer: 3, employee: 2 };
      resolved.sort(
        (a, b) => (rank[b.role] || 0) - (rank[a.role] || 0) || a.name.localeCompare(b.name)
      );
      setMembers(resolved);

      // Org projects (read-only oversight).
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, name, status, progress, deadline")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      setProjects(projectRows || []);
    } catch (e) {
      setError("Could not load team data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const activeCount = members.filter((m) => m.status === "active").length;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
          <div className="text-sm font-medium text-muted-foreground">Loading team…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Team members" value={members.length} icon={Users} tone="primary" />
        <StatCard title="Active" value={activeCount} icon={ShieldCheck} tone="success" />
        <StatCard title="Projects" value={projects.length} icon={FolderKanban} tone="info" />
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Team roster */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-[18px] w-[18px] text-primary" />
            Team roster
          </h3>
          <button
            onClick={fetchTeam}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {members.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <UserCircle className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No team members yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Team</th>
                  <th className="px-5 py-3">Department</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                          {(m.name || "U").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{m.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          ROLE_TONE[m.role] || "bg-muted text-muted-foreground"
                        }`}
                      >
                        {pretty(m.role)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{m.team || "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{m.department || "—"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          m.status === "active"
                            ? "bg-success/10 text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {pretty(m.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Org projects (read-only) */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FolderKanban className="h-[18px] w-[18px] text-primary" />
            Projects overview
          </h3>
        </div>
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No projects yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{p.name}</p>
                  {p.deadline && (
                    <p className="text-xs text-muted-foreground">
                      Due {new Date(p.deadline).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="w-32 shrink-0">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, Number(p.progress) || 0))}%` }}
                    />
                  </div>
                </div>
                <span className="w-24 shrink-0 text-right text-xs font-medium capitalize text-muted-foreground">
                  {p.status || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
