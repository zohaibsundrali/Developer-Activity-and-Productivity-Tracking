"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { can } from "@/utils/permissions";
import { authFetch } from "@/utils/authFetch";
import { showSuccess, showError, showConfirm } from "@/utils/alerts";
import {
  PageHeader, Section, Card, CardHeader, CardTitle, CardDescription, CardContent,
  Badge, StatusPill, EmptyState, Skeleton, SkeletonTable, SkeletonCard,
  ErrorState, Tabs, Field, Button, Input,
} from "@/components/ui";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import {
  Building2, Users, UserCog, Mail, Plus, Trash2, Copy, RefreshCw, Shield,
} from "lucide-react";
import OrganizationSettings from "@/components/admin/OrganizationSettings";

// Ordered highest → lowest, matching ROLE_RANK in src/utils/permissions.js and
// the CHECK constraint in database/058. A picker that lists roles in a
// different order from the one the product ranks them in is a small thing that
// makes people pick the wrong one.
const ROLES = [
  "owner",
  "admin",
  "manager",
  "hr",
  "finance",
  "team_lead",
  "qa",
  "developer",
  "designer",
  "employee",
  "client",
];

// Slugs whose display form is not just Title Case. "Qa" reads as a name; the
// role is QA.
const ROLE_LABEL_OVERRIDES = { hr: "HR", qa: "QA" };

// Human label for a role slug (team_lead -> "Team Lead").
export const roleLabel = (role) => {
  const slug = String(role || "");
  if (ROLE_LABEL_OVERRIDES[slug]) return ROLE_LABEL_OVERRIDES[slug];
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

// Role -> Badge variant. Token palette only; the badge always carries the role
// text as well, so the role is never communicated by colour alone.
const roleVariant = (role) => {
  const r = String(role || "").toLowerCase();
  if (r === "owner") return "default";
  if (r === "admin") return "info";
  if (r === "manager" || r === "team_lead" || r === "hr" || r === "finance") return "secondary";
  if (r === "client") return "warning";
  return "outline";
};

// Invitation status -> StatusPill status (colour + a distinct icon shape).
const invitePillStatus = (s) => {
  if (s === "accepted") return "success";
  if (s === "pending") return "pending";
  return "unknown";
};

const TABS = [
  { id: "departments", label: "Departments" },
  { id: "teams", label: "Teams" },
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "settings", label: "Settings" },
];

/* Shared presentation classes — the table/control shapes the UI kit contract asks for. */
const TABLE_SHELL = "overflow-x-auto rounded-xl border border-border bg-card shadow-card";
const TH = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TH_RIGHT = "px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TR = "h-12 transition-colors duration-150 hover:bg-muted/40";
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const CONTROL = `w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 ${FOCUS_RING}`;
const CONTROL_SM = `rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground transition-colors duration-150 ${FOCUS_RING}`;
/* Icon-only row actions. `icon-sm` is a 28px box — under any touch minimum, on
   controls that copy a live invite link and irreversibly revoke an invitation.
   44px on touch, 40px from sm up; the glyph itself is unchanged. */
const ICON_BTN_SIZE = "size-11 sm:size-10";
const ICON_BTN = `${ICON_BTN_SIZE} text-muted-foreground hover:text-foreground ${FOCUS_RING}`;
const DANGER_ICON_BTN = `${ICON_BTN_SIZE} text-muted-foreground hover:bg-destructive/10 hover:text-destructive ${FOCUS_RING}`;

/**
 * supabase-js RESOLVES with `{ data, error }` — it does not reject — so a
 * try/catch around a query never fires, and reading only `.data` renders an
 * RLS denial, a 4xx and a 5xx as "no rows". Read the error that is already
 * being returned and throw it, so the catch (and the ErrorState it feeds)
 * becomes reachable.
 */
function unwrap(result, label) {
  if (result?.error) throw new Error(result.error.message || `Could not load ${label}.`);
  return result?.data ?? [];
}

/**
 * Load every section of this organization. Throws if ANY of the four queries
 * failed, so a partial answer is never shown as a complete one.
 */
export async function fetchOrganizationSections(orgId) {
  const [dep, tm, mem, inv] = await Promise.all([
    supabase.from("departments").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("teams").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("memberships").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("invitations").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
  ]);
  // Evaluated in order, so the first failure throws before anything is stored.
  return {
    departments: unwrap(dep, "departments"),
    teams: unwrap(tm, "teams"),
    members: unwrap(mem, "members"),
    invitations: unwrap(inv, "invitations"),
  };
}

/**
 * Copy text and report what actually happened.
 *
 * `navigator.clipboard` is undefined outside a secure context (the optional
 * chain then swallowed the whole call), and `writeText` rejects with
 * NotAllowedError when the permission is refused. Both used to end with a
 * "Link copied" toast for a clipboard that was never written.
 */
export async function copyToClipboard(text) {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("This browser blocked clipboard access.");
    }
    await navigator.clipboard.writeText(text);
    showSuccess("Link copied", text);
    return true;
  } catch (err) {
    showError("Couldn't copy the link", `${err?.message || "Copying was blocked."} Copy it manually: ${text}`);
    return false;
  }
}

/**
 * Delete a team, detaching its members — as ONE indivisible operation.
 *
 * This used to be two PostgREST round-trips from here: update the memberships,
 * then delete the team. Two round-trips are two transactions, and supabase-js
 * has no client-side transaction to wrap them in, so a failure of the second
 * left the first committed — every member detached from a team that still
 * existed, repairable only by hand. Ordering the pair and reporting which half
 * landed made that visible; it could not prevent it.
 *
 * Both writes now happen inside a single Postgres function
 * (public.delete_team_with_members, migration 043) invoked by
 * DELETE /api/admin/teams/[id]. A function body is one transaction: both
 * effects commit together or neither does. The same two effects, in the same
 * order — the team's members stay in the organisation and simply lose the team.
 *
 * So a failure here means NOTHING was changed, and `detachedCount` is a count
 * the database returned rather than an assumption. The route also re-derives
 * the organisation from the caller's verified token, so the delete can only
 * ever reach this org's own teams.
 */
export async function deleteTeamWithMembers(team) {
  try {
    const res = await authFetch(`/api/admin/teams/${encodeURIComponent(team.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      return {
        ok: false,
        detachedCount: 0,
        message: data?.error || `Could not delete the team (HTTP ${res.status}).`,
      };
    }
    return { ok: true, detachedCount: data.detached ?? 0, message: null };
  } catch (err) {
    // fetch() rejects on a network failure — the one case where the request may
    // never have reached the server. The transaction still decides it: either
    // the function ran and committed both writes, or it did not run at all.
    return {
      ok: false,
      detachedCount: 0,
      message: err?.message || "Could not reach the server to delete the team.",
    };
  }
}

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
  // Starts true: the first fetch has not run yet, and "no departments yet" is a
  // claim about the database that nothing has checked.
  const [loading, setLoading] = useState(true);
  // Presentation-only: surfaces the failure the loader already caught so the
  // screen can offer a retry instead of an empty table.
  const [error, setError] = useState(null);

  useEffect(() => {
    setOrgId(getOrgId());
    setCtx(getOrgContext());
    setOrgReady(true);
  }, []);

  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOrganizationSections(orgId);
      setDepartments(rows.departments);
      setTeams(rows.teams);
      setMembers(rows.members);
      setInvitations(rows.invitations);
    } catch (err) {
      setError(err?.message || "Something went wrong while loading this organization.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!orgReady) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-5 lg:grid-cols-3">
          <SkeletonCard className="lg:col-span-1" lines={4} />
          <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </div>
        </div>
      </div>
    );
  }

  if (!orgId) {
    return (
      <EmptyState
        icon={Building2}
        title="No organization context found"
        description="We couldn't tell which workspace you're in. Please sign in again."
      />
    );
  }

  const counts = {
    departments: departments.length,
    teams: teams.length,
    members: members.length,
    invitations: invitations.length,
  };
  const tabItems = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    // No badge while loading, and none after a failure either — a count is a
    // fact about the data, and after a failed load there is no fact to state.
    count: loading || error ? undefined : counts[t.id],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionTitle("organization", "admin")}
        description={`${ctx?.organizationName || "Your workspace"} · manage departments, teams, members & invitations`}
        actions={
          <Button variant="outline" onClick={loadAll} disabled={loading}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Tabs tabs={tabItems} active={tab} onChange={setTab} aria-label="Organization sections" />

      <div key={tab} className="animate-fade-in motion-reduce:animate-none">
        {tab === "departments" && (
          <DepartmentsTab orgId={orgId} departments={departments} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "teams" && (
          <TeamsTab orgId={orgId} teams={teams} departments={departments} members={members} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "members" && (
          <MembersTab teams={teams} departments={departments} members={members} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "invitations" && (
          <InvitationsTab orgId={orgId} invitations={invitations} teams={teams} departments={departments} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "settings" && <OrganizationSettings readOnly={!can("manage_settings")} />}
      </div>
    </div>
  );
}

/* ---------------- Departments ---------------- */
function DepartmentsTab({ orgId, departments, reload, loading, loadError }) {
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
    // The delete resolves with { error } rather than rejecting: unread, a
    // refused delete left the row on screen with no feedback at all.
    const { error } = await supabase.from("departments").delete().eq("id", d.id);
    if (error) {
      showError("Delete failed", error.message || `Could not delete "${d.name}".`);
      return;
    }
    showSuccess("Department deleted", `"${d.name}" removed.`);
    reload();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 aria-hidden="true" className="h-4 w-4 text-primary" /> New department
          </CardTitle>
          <CardDescription>Departments group teams; teams group people.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-4">
            <Field label="Name" htmlFor="dept-name">
              <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
            </Field>
            <Field label="Description" htmlFor="dept-description">
              <textarea id="dept-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                placeholder="Optional" className={CONTROL} />
            </Field>
            <Button type="submit" disabled={saving} className="w-full">
              <Plus aria-hidden="true" className="h-4 w-4" /> {saving ? "Adding…" : "Add department"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Departments">
          {loadError ? (
            <ErrorState title="Couldn't load departments" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          ) : departments.length === 0 ? (
            <EmptyState icon={Building2} title="No departments yet"
              description="Add your first department on the left to start organising teams." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {departments.map((d) => (
                <Card key={d.id}>
                  <CardContent className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{d.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{d.description || "No description"}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(d)}
                      title="Delete department" aria-label={`Delete department ${d.name}`}
                      className={`shrink-0 ${DANGER_ICON_BTN}`}>
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------------- Teams ---------------- */
function TeamsTab({ orgId, teams, departments, members, reload, loading, loadError }) {
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
    const res = await deleteTeamWithMembers(t);
    if (!res.ok) {
      // "Nothing was changed" is now a fact, not a hope: the detach and the
      // delete share one transaction, so a failure rolls both back. There is no
      // longer a half-applied case to warn about, and no members to re-assign.
      showError("Delete failed", `${res.message} Nothing was changed — the team and its members are untouched.`);
      reload();
      return;
    }
    showSuccess(
      "Team deleted",
      res.detachedCount > 0
        ? `"${t.name}" removed. ${res.detachedCount} ${res.detachedCount === 1 ? "member stays" : "members stay"} in the organization, without a team.`
        : `"${t.name}" removed.`
    );
    reload();
  };

  const nameOf = (id) => members.find((m) => m.id === id)?.email || "—";
  const depName = (id) => departments.find((d) => d.id === id)?.name || "—";

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users aria-hidden="true" className="h-4 w-4 text-primary" /> New team
          </CardTitle>
          <CardDescription>A team can sit under a department and have a manager.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-4">
            <Field label="Team name" htmlFor="team-name">
              <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend Squad" />
            </Field>
            <Field label="Department" htmlFor="team-department">
              <select id="team-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={CONTROL}>
                <option value="">— None —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Manager" htmlFor="team-manager">
              <select id="team-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)} className={CONTROL}>
                <option value="">— None —</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.email} ({m.role})</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={saving} className="w-full">
              <Plus aria-hidden="true" className="h-4 w-4" /> {saving ? "Creating…" : "Create team"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Teams">
          {loadError ? (
            <ErrorState title="Couldn't load teams" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
            </div>
          ) : teams.length === 0 ? (
            <EmptyState icon={Users} title="No teams yet"
              description="Create a team to give members a place to belong." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {teams.map((t) => (
                <Card key={t.id}>
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate font-semibold text-foreground">{t.name}</p>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(t)}
                        title="Delete team" aria-label={`Delete team ${t.name}`}
                        className={`shrink-0 ${DANGER_ICON_BTN}`}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                    <dl className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt className="font-medium text-foreground">Dept:</dt>
                        <dd className="truncate">{depName(t.department_id)}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="font-medium text-foreground">Manager:</dt>
                        <dd className="truncate">{nameOf(t.manager_id)}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="font-medium text-foreground">Members:</dt>
                        <dd>{members.filter((m) => m.team_id === t.id).length}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------------- Members ---------------- */
function MembersTab({ teams, departments, members, reload, loading, loadError }) {
  // `role` is the one field that cannot be patched from the browser.
  //
  // A member's role lives in TWO places: `memberships.role`, which this table
  // shows, and app_metadata.role in the member's JWT, which is what RLS
  // actually enforces (public.auth_role(), migration 018). Writing the row
  // alone left the JWT claim untouched, so a demotion never took effect — the
  // demoted account kept passing every RLS check, including the one that let it
  // put its own role back — and a promotion only unlocked the UI. The API route
  // writes both, in the order that keeps a partial failure restrictive, and
  // refuses the changes this table cannot police (self-demotion, granting
  // owner, HR reaching above itself).
  const update = async (id, patch) => {
    const { role, ...directPatch } = patch;

    if (role !== undefined) {
      const res = await authFetch("/api/admin/members/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: id, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        showError("Role change failed", data?.error || "Could not change the role.");
        return;
      }
    }

    if (Object.keys(directPatch).length) {
      const { error } = await supabase.from("memberships").update(directPatch).eq("id", id);
      if (error) {
        showError("Update failed", error.message || "Could not update member.");
        return;
      }
    }

    reload();
  };

  return (
    <Section title="Members" description="Role changes go through the server so the JWT claim moves with the row.">
      {loadError ? (
        <ErrorState title="Couldn't load members" description={loadError} onRetry={reload} />
      ) : loading ? (
        <div className={TABLE_SHELL}><SkeletonTable rows={6} cols={5} /></div>
      ) : members.length === 0 ? (
        <EmptyState icon={UserCog} title="No members yet"
          description="Invite a teammate from the Invitations tab — they appear here once they accept." />
      ) : (
        <div className={TABLE_SHELL}>
          <table className="w-full min-w-[820px] divide-y divide-border">
            <thead>
              <tr className="bg-muted/40">
                <th scope="col" className={TH}>Member</th>
                <th scope="col" className={TH}>Role</th>
                <th scope="col" className={TH}>Team</th>
                <th scope="col" className={TH}>Department</th>
                <th scope="col" className={TH}>Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.id} className={TR}>
                  <td className="px-4">
                    <p className="text-sm font-medium text-foreground">{m.email}</p>
                  </td>
                  <td className="px-4">
                    <div className="flex items-center gap-2">
                      <Badge variant={roleVariant(m.role)} size="sm">{roleLabel(m.role)}</Badge>
                      <select value={m.role} onChange={(e) => update(m.id, { role: e.target.value })}
                        disabled={m.role === "owner"}
                        aria-label={`Change role for ${m.email}`}
                        className={`${CONTROL_SM} disabled:cursor-not-allowed disabled:opacity-50`}>
                        {/* "owner" is not an assignable role here — ownership can't be
                            granted from the member dropdown to avoid accidental escalation. */}
                        {ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="px-4">
                    <select value={m.team_id || ""} onChange={(e) => update(m.id, { team_id: e.target.value || null })}
                      aria-label={`Change team for ${m.email}`} className={CONTROL_SM}>
                      <option value="">—</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4">
                    <select value={m.department_id || ""} onChange={(e) => update(m.id, { department_id: e.target.value || null })}
                      aria-label={`Change department for ${m.email}`} className={CONTROL_SM}>
                      <option value="">—</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 text-xs capitalize text-muted-foreground">{m.user_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ---------------- Invitations ---------------- */
function InvitationsTab({ orgId, invitations, teams, departments, reload, loading, loadError }) {
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

  // `navigator.clipboard?.writeText(link)` is a silent no-op outside a secure
  // context, and its promise rejects with NotAllowedError when permission is
  // refused — neither of which stopped the "Link copied" toast from firing.
  const copyLink = async (inv) => {
    const link = `${window.location.origin}/invite/${inv.token}`;
    await copyToClipboard(link);
  };

  const revoke = async (inv) => {
    const ok = await showConfirm("Revoke invitation?", `Revoke invite for ${inv.email}?`);
    if (!ok) return;
    const { error } = await supabase.from("invitations").update({ status: "revoked" }).eq("id", inv.id);
    if (error) {
      showError("Revoke failed", error.message || `Could not revoke the invitation for ${inv.email}.`);
      return;
    }
    showSuccess("Invitation revoked", `The invite for ${inv.email} can no longer be used.`);
    reload();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield aria-hidden="true" className="h-4 w-4 text-primary" /> Invite a member
          </CardTitle>
          <CardDescription>The role here is what they get on acceptance.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={invite} className="space-y-4">
            <Field label="Email" htmlFor="invite-email" required>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com" required />
            </Field>
            <Field label="Role" htmlFor="invite-role">
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} className={CONTROL}>
                {ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </Field>
            <Field label="Team" htmlFor="invite-team">
              <select id="invite-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={CONTROL}>
                <option value="">— None —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Department" htmlFor="invite-department">
              <select id="invite-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={CONTROL}>
                <option value="">— None —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={sending} className="w-full">
              <Mail aria-hidden="true" className="h-4 w-4" /> {sending ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Invitations" description="Pending, accepted and revoked invites for this organization.">
          {loadError ? (
            <ErrorState title="Couldn't load invitations" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className={TABLE_SHELL}><SkeletonTable rows={5} cols={4} /></div>
          ) : invitations.length === 0 ? (
            <EmptyState icon={Mail} title="No invitations yet"
              description="Invite a teammate with the form on the left." />
          ) : (
            <div className={TABLE_SHELL}>
              <table className="w-full min-w-[560px] divide-y divide-border">
                <thead>
                  <tr className="bg-muted/40">
                    <th scope="col" className={TH}>Email</th>
                    <th scope="col" className={TH}>Role</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH_RIGHT}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className={TR}>
                      <td className="px-4 text-sm font-medium text-foreground">{inv.email}</td>
                      <td className="px-4">
                        <Badge variant={roleVariant(inv.role)} size="sm">{roleLabel(inv.role)}</Badge>
                      </td>
                      <td className="px-4">
                        <StatusPill status={invitePillStatus(inv.status)} label={inv.status} size="sm" className="capitalize" />
                      </td>
                      <td className="px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => copyLink(inv)}
                            title="Copy invite link" aria-label={`Copy invite link for ${inv.email}`}
                            className={ICON_BTN}>
                            <Copy aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          {inv.status === "pending" && (
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => revoke(inv)}
                              title="Revoke" aria-label={`Revoke invitation for ${inv.email}`}
                              className={DANGER_ICON_BTN}>
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
