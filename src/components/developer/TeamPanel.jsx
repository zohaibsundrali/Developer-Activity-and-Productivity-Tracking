"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import StatCard from "@/components/shell/StatCard";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  SkeletonTable,
  StatusPill,
} from "@/components/ui";
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

// Role → Badge variant. There is no violet token in the palette, so `owner`
// uses the neutral outline rather than reintroducing a literal colour.
const ROLE_VARIANT = {
  owner: "outline",
  admin: "default",
  manager: "info",
  developer: "success",
  employee: "secondary",
  client: "warning",
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
  const [myUserId, setMyUserId] = useState(null);

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMyUserId(getOrgContext()?.userId || null);
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
        .select("id, user_id, user_type, email, role, team_id, department_id, status, reports_to")
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
          userId: m.user_id,
          reportsTo: m.reports_to || null,
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
  // Direct reports = staff whose reporting manager is the current user.
  const myReports = myUserId ? members.filter((m) => m.reportsTo && m.reportsTo === myUserId) : [];

  // Skeletons shaped like the loaded page: three tiles, then the roster table.
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <StatCard key={i} title="" value="" loading />
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          <Skeleton className="mb-4 h-4 w-32" />
          <SkeletonTable rows={5} cols={5} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          <Skeleton className="mb-4 h-4 w-40" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // A failed load is an error surface with a retry, not a red strip above
  // three zeroed tiles that look like real data.
  if (error) {
    return <ErrorState title="Couldn't load your team" description={error} onRetry={fetchTeam} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Your teammates and the people who report to you."
      />

      {/* Direct reports — only shown to a supervisor who has assigned reports. */}
      {myReports.length > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 shadow-card">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-[18px] w-[18px] text-primary" />
            Your direct reports ({myReports.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {myReports.map((m) => (
              <span key={m.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {(m.name || "U").charAt(0).toUpperCase()}
                </span>
                {m.name}
                <span className="text-muted-foreground">· {pretty(m.role)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Team members" value={members.length} icon={Users} tone="primary" />
        <StatCard title="Active" value={activeCount} icon={ShieldCheck} tone="success" />
        <StatCard title="Projects" value={projects.length} icon={FolderKanban} tone="info" />
      </div>

      {/* Team roster */}
      <Section
        title="Team roster"
        description="Everyone in your organization, ranked by role."
        actions={
          <Button variant="outline" size="sm" onClick={fetchTeam}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        }
        className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
      >
        {members.length === 0 ? (
          <EmptyState
            icon={UserCircle}
            title="No team members yet"
            description="People added to your organization appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] divide-y divide-border text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3">Member</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Team</th>
                  <th scope="col" className="px-4 py-3">Department</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="h-12 transition-colors duration-150 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {(m.name || "U").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground" title={m.name}>{m.name}</p>
                          <p className="truncate text-xs text-muted-foreground" title={m.email}>{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ROLE_VARIANT[m.role] || "secondary"} size="sm">
                        {pretty(m.role)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{m.team || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.department || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={m.status === "active" ? "active" : "inactive"}
                        label={pretty(m.status)}
                        size="sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Org projects (read-only) */}
      <Section
        title="Projects overview"
        description="Read-only view of every project in the organization."
        className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
      >
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Projects created in your organization appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {projects.map((p) => {
              const progress = Math.min(100, Math.max(0, Number(p.progress) || 0));
              return (
                <li key={p.id} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground" title={p.name}>{p.name}</p>
                    {p.deadline && (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        Due {new Date(p.deadline).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex w-40 shrink-0 items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {progress}%
                    </span>
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-medium capitalize text-muted-foreground">
                    {p.status || "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
