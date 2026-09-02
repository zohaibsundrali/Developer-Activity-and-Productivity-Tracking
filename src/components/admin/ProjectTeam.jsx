"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus, Users, X } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Section,
  Skeleton,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { PROJECT_ROLES } from "@/utils/roles";
import { roleLabel } from "@/components/shared/roleMeta";

/**
 * Who is on this project, and in what capacity.
 *
 * WHY THIS SCREEN EXISTS AT ALL. `permissionEngine.js` has always accepted a
 * `projectRoles` map and a `scope.projectId`, and nothing ever supplied either.
 * The database could not: `projects.assigned_to` holds ONE developer and
 * `manager_id` ONE manager, so there was nowhere to record "three developers, a
 * designer and a QA, and Ayesha leads". Migration 071 adds the table and this
 * is where a person puts somebody on it.
 *
 * `canManage` COMES FROM THE SERVER. The obvious thing would be
 * allowed("project.manage_members"), but that helper builds its subject from
 * the role alone — it has no project roles in it — so it can only answer the
 * organization-wide question. It would show these controls to every manager in
 * the company, and every one of them who is not on this project would get a 404
 * on use. The route already computed the right answer; it sends it.
 *
 * THE MANAGER ROW IS READ-ONLY HERE, and the button says why rather than being
 * quietly absent. `projects.manager_id` is the authority for who runs a project
 * and a trigger keeps this row in step with it; removing it from underneath
 * would recreate the disagreement that trigger exists to prevent.
 */

const MANAGER = "manager";

function roleTone(role) {
  if (role === MANAGER) return "default";
  if (role === "team_lead") return "secondary";
  return "outline";
}

export default function ProjectTeam({ projectId }) {
  const [state, setState] = useState({ loading: true, error: null, members: [], canManage: false });
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pickedUser, setPickedUser] = useState("");
  const [pickedRole, setPickedRole] = useState("developer");

  const load = useCallback(async () => {
    if (!projectId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await authFetch(`/api/projects/${projectId}/members`);
      const body = await res.json().catch(() => ({}));
      // `res.ok` is checked before the body is trusted: a 404 here is the
      // route declining to say whether the project exists, and reading
      // `body.members` off it would render an empty team as a fact.
      if (!res.ok) throw new Error(body?.error || "Could not load the project team.");
      setState({
        loading: false,
        error: null,
        members: body.members || [],
        canManage: Boolean(body.canManage),
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || "Could not load the project team.", members: [], canManage: false });
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // The people who could be added. Read straight from memberships: RLS already
  // limits this to the caller's own organization and excludes clients, so there
  // is no route to add for it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const orgId = getOrgId();
      if (!orgId) return;
      const { data, error } = await supabase
        .from("memberships")
        .select("user_id, email, role, status, user_type")
        .eq("organization_id", orgId)
        .eq("status", "active");
      if (!cancelled && !error) setStaff(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onProject = useMemo(
    () => new Set(state.members.map((m) => String(m.userId))),
    [state.members]
  );

  const addable = useMemo(
    () => staff.filter((s) => s.user_type !== "client" && !onProject.has(String(s.user_id))),
    [staff, onProject]
  );

  const nameFor = useCallback(
    (userId) => staff.find((s) => String(s.user_id) === String(userId))?.email || "Unknown member",
    [staff]
  );

  const add = useCallback(async () => {
    if (!pickedUser) return showError("Pick somebody first.");
    setBusy(true);
    try {
      const res = await authFetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: pickedUser, projectRole: pickedRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not update the project team.");
      setState((s) => ({ ...s, members: body.members || [], canManage: Boolean(body.canManage) }));
      setPickedUser("");
      showSuccess("Added to the project");
    } catch (e) {
      showError(e?.message || "Could not update the project team.");
    } finally {
      setBusy(false);
    }
  }, [projectId, pickedUser, pickedRole]);

  const remove = useCallback(
    async (userId) => {
      setBusy(true);
      try {
        const res = await authFetch(`/api/projects/${projectId}/members`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not update the project team.");
        setState((s) => ({ ...s, members: body.members || [], canManage: Boolean(body.canManage) }));
        showSuccess("Removed from the project");
      } catch (e) {
        showError(e?.message || "Could not update the project team.");
      } finally {
        setBusy(false);
      }
    },
    [projectId]
  );

  if (state.loading) {
    return (
      <Section title="Project team">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="mt-2 h-9 w-full" />
      </Section>
    );
  }

  if (state.error) {
    return (
      <Section title="Project team">
        <ErrorState description={state.error} onRetry={load} />
      </Section>
    );
  }

  return (
    <Section
      title="Project team"
      description="Who is on this project, and what they do on it. A person's role here is separate from their role in the organization."
    >
      {state.members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody is on this project yet"
          description="Add the people working on it so their access can be scoped to it."
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {state.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{nameFor(m.userId)}</span>
                <span className="text-xs text-muted-foreground">
                  {m.allocationPct != null ? `${m.allocationPct}% allocated` : "Allocation not set"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={roleTone(m.projectRole)} className="capitalize">
                  {roleLabel(m.projectRole)}
                </Badge>
                {state.canManage && m.projectRole !== MANAGER && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => remove(m.userId)}
                    aria-label={`Remove ${nameFor(m.userId)} from the project`}
                    title="Remove from the project"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {state.canManage && m.projectRole === MANAGER && (
                  <span className="text-xs text-muted-foreground">
                    {/* Stated, not hidden: a control that silently is not there
                        reads as a bug. */}
                    Change under Manager
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.canManage && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field label="Person" htmlFor="pt-user">
            <select
              id="pt-user"
              value={pickedUser}
              onChange={(e) => setPickedUser(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pick somebody…</option>
              {addable.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.email} — {roleLabel(s.role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="On this project" htmlFor="pt-role">
            <select
              id="pt-role"
              value={pickedRole}
              onChange={(e) => setPickedRole(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {/* `manager` is absent on purpose: it is set through Assign
                  manager, which writes projects.manager_id, and a trigger keeps
                  this table in step with it. Offering it here would be a second
                  way to say the same thing. */}
              {PROJECT_ROLES.filter((r) => r !== MANAGER).map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={add} disabled={busy || !pickedUser}>
            <UserPlus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
      )}
    </Section>
  );
}
