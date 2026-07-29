"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { can } from "@/utils/permissions";
import { authFetch } from "@/utils/authFetch";
import { showSuccess, showError, showConfirm } from "@/utils/alerts";
import {
  Building2, Users, UserCog, Mail, Plus, Trash2, Copy, RefreshCw, Shield, Settings as SettingsIcon,
} from "lucide-react";
import OrganizationSettings from "@/components/admin/OrganizationSettings";

const ROLES = ["owner", "admin", "manager", "team_lead", "hr", "developer", "employee", "client"];

// Human label for a role slug (team_lead -> "Team Lead").
export const roleLabel = (role) =>
  String(role || "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const roleBadge = (role) => {
  const r = String(role || "").toLowerCase();
  if (r === "owner") return "bg-primary/10 text-primary";
  if (r === "admin") return "bg-info/10 text-info";
  if (r === "manager") return "bg-violet-500/10 text-violet-600";
  if (r === "team_lead") return "bg-indigo-500/10 text-indigo-600";
  if (r === "hr") return "bg-pink-500/10 text-pink-600";
  if (r === "client") return "bg-warning/10 text-warning";
  return "bg-muted text-muted-foreground";
};

const TABS = [
  { id: "departments", label: "Departments", icon: Building2 },
  { id: "teams", label: "Teams", icon: Users },
  { id: "members", label: "Members", icon: UserCog },
  { id: "invitations", label: "Invitations", icon: Mail },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export default function OrganizationManagement() {
  // Read org context after mount only — reading window/sessionStorage during
  // render causes a server/client hydration mismatch.
  const [orgId, setOrgId] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [orgReady, setOrgReady] = useState(false);
  const [tab, setTab] = useState("departments");
  const [departments, setDepartments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setOrgId(getOrgId());
    setCtx(getOrgContext());
    setOrgReady(true);
  }, []);

  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [dep, tm, mem, inv] = await Promise.all([
        supabase.from("departments").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
        supabase.from("teams").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
        supabase.from("memberships").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
        supabase.from("invitations").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
      ]);
      setDepartments(dep.data || []);
      setTeams(tm.data || []);
      setMembers(mem.data || []);
      setInvitations(inv.data || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!orgReady) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        Loading organization…
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        No organization context found. Please sign in again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Organization</h2>
          <p className="text-sm text-muted-foreground">
            {ctx?.organizationName || "Your workspace"} · manage departments, teams, members &amp; invitations
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-card transition-colors hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "departments" && (
        <DepartmentsTab orgId={orgId} departments={departments} reload={loadAll} />
      )}
      {tab === "teams" && (
        <TeamsTab orgId={orgId} teams={teams} departments={departments} members={members} reload={loadAll} />
      )}
      {tab === "members" && (
        <MembersTab teams={teams} departments={departments} members={members} reload={loadAll} />
      )}
      {tab === "invitations" && (
        <InvitationsTab orgId={orgId} invitations={invitations} teams={teams} departments={departments} reload={loadAll} />
      )}
      {tab === "settings" && <OrganizationSettings readOnly={!can("manage_settings")} />}
    </div>
  );
}

/* ---------------- Departments ---------------- */
function DepartmentsTab({ orgId, departments, reload }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("departments").insert([{ organization_id: orgId, name: name.trim(), description: description.trim() || null }]);
      if (error) throw error;
      setName(""); setDescription("");
      showSuccess("Department added", `"${name.trim()}" created.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not add department.");
    } finally { setSaving(false); }
  };

  const remove = async (d) => {
    const ok = await showConfirm("Delete department?", `Remove "${d.name}"? Teams keep working but lose this department link.`);
    if (!ok) return;
    await supabase.from("departments").delete().eq("id", d.id);
    reload();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={add} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 text-sm font-semibold text-foreground">New department</h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? "Adding…" : "Add department"}
        </button>
      </form>

      <div className="lg:col-span-2">
        {departments.length === 0 ? (
          <EmptyCard label="No departments yet" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {departments.map((d) => (
              <div key={d.id} className="flex items-start justify-between rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{d.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{d.description || "No description"}</p>
                </div>
                <button onClick={() => remove(d)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Teams ---------------- */
function TeamsTab({ orgId, teams, departments, members, reload }) {
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [saving, setSaving] = useState(false);

  const managers = members.filter((m) => ["owner", "admin", "manager"].includes(m.role));

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("teams").insert([{
        organization_id: orgId, name: name.trim(),
        department_id: departmentId || null, manager_id: managerId || null,
      }]);
      if (error) throw error;
      setName(""); setDepartmentId(""); setManagerId("");
      showSuccess("Team created", `"${name.trim()}" added.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not create team.");
    } finally { setSaving(false); }
  };

  const remove = async (t) => {
    const ok = await showConfirm("Delete team?", `Remove "${t.name}"? Members stay in the org but leave this team.`);
    if (!ok) return;
    await supabase.from("memberships").update({ team_id: null }).eq("team_id", t.id);
    await supabase.from("teams").delete().eq("id", t.id);
    reload();
  };

  const nameOf = (id) => members.find((m) => m.id === id)?.email || "—";
  const depName = (id) => departments.find((d) => d.id === id)?.name || "—";

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={add} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 text-sm font-semibold text-foreground">New team</h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Team name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend Squad"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Department</label>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— None —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="mb-1 block text-xs font-medium text-foreground">Manager</label>
        <select value={managerId} onChange={(e) => setManagerId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— None —</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.email} ({m.role})</option>)}
        </select>
        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? "Creating…" : "Create team"}
        </button>
      </form>

      <div className="lg:col-span-2">
        {teams.length === 0 ? (
          <EmptyCard label="No teams yet" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between">
                  <p className="truncate font-semibold text-foreground">{t.name}</p>
                  <button onClick={() => remove(t)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p><span className="font-medium text-foreground">Dept:</span> {depName(t.department_id)}</p>
                  <p><span className="font-medium text-foreground">Manager:</span> {nameOf(t.manager_id)}</p>
                  <p><span className="font-medium text-foreground">Members:</span> {members.filter((m) => m.team_id === t.id).length}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Members ---------------- */
function MembersTab({ teams, departments, members, reload }) {
  const update = async (id, patch) => {
    const { error } = await supabase.from("memberships").update(patch).eq("id", id);
    if (error) {
      showError("Update failed", error.message || "Could not update member.");
      return;
    }
    reload();
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Member</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No members yet.</td></tr>
          ) : members.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <p className="text-sm font-medium text-foreground">{m.email}</p>
              </td>
              <td className="px-4 py-3">
                <select value={m.role} onChange={(e) => update(m.id, { role: e.target.value })}
                  disabled={m.role === "owner"}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold outline-none ${roleBadge(m.role)} disabled:opacity-70`}>
                  {/* "owner" is not an assignable role here — ownership can't be
                      granted from the member dropdown to avoid accidental escalation. */}
                  {ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
              </td>
              <td className="px-4 py-3">
                <select value={m.team_id || ""} onChange={(e) => update(m.id, { team_id: e.target.value || null })}
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus:border-primary">
                  <option value="">—</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </td>
              <td className="px-4 py-3">
                <select value={m.department_id || ""} onChange={(e) => update(m.id, { department_id: e.target.value || null })}
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus:border-primary">
                  <option value="">—</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{m.user_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Invitations ---------------- */
function InvitationsTab({ orgId, invitations, teams, departments, reload }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");
  const [teamId, setTeamId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [sending, setSending] = useState(false);

  const invite = async (e) => {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;

    // Prevent sending a second pending invite to the same address.
    const dup = invitations.find(
      (inv) => inv.status === "pending" && (inv.email || "").toLowerCase() === target
    );
    if (dup) {
      showError("Already invited", `${email.trim()} already has a pending invitation.`);
      return;
    }

    setSending(true);
    try {
      const res = await authFetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          teamId: teamId || null,
          departmentId: departmentId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to create invitation");
      setEmail(""); setTeamId(""); setDepartmentId("");
      showSuccess("Invitation sent", data.emailed ? `Invite emailed to ${email.trim()}.` : `Invite created. Share the link.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not send invitation.");
    } finally { setSending(false); }
  };

  const copyLink = (inv) => {
    const link = `${window.location.origin}/invite/${inv.token}`;
    navigator.clipboard?.writeText(link);
    showSuccess("Link copied", link);
  };

  const revoke = async (inv) => {
    const ok = await showConfirm("Revoke invitation?", `Revoke invite for ${inv.email}?`);
    if (!ok) return;
    await supabase.from("invitations").update({ status: "revoked" }).eq("id", inv.id);
    reload();
  };

  const statusBadge = (s) => {
    if (s === "accepted") return "bg-success/10 text-success";
    if (s === "pending") return "bg-warning/10 text-warning";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={invite} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Shield className="h-4 w-4 text-primary" /> Invite a member</h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          {ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <label className="mb-1 block text-xs font-medium text-foreground">Team</label>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— None —</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="mb-1 block text-xs font-medium text-foreground">Department</label>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— None —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button disabled={sending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Mail className="h-4 w-4" /> {sending ? "Sending…" : "Send invitation"}
        </button>
      </form>

      <div className="lg:col-span-2">
        {invitations.length === 0 ? (
          <EmptyCard label="No invitations yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{inv.email}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${roleBadge(inv.role)}`}>{roleLabel(inv.role)}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(inv.status)}`}>{inv.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => copyLink(inv)} title="Copy invite link" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <Copy className="h-4 w-4" />
                        </button>
                        {inv.status === "pending" && (
                          <button onClick={() => revoke(inv)} title="Revoke" className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCard({ label }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
