"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Minus, X, KeyRound, ShieldAlert } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  SkeletonTable,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";
import { sectionTitle } from "@/components/shell/navConfig";
import {
  PERMISSIONS,
  PERMISSION_MODULES,
  defaultRolesFor,
} from "@/utils/permissionCatalogue";

/**
 * Who may do what, and the exceptions.
 *
 * TWO QUESTIONS ON ONE SCREEN, and they are genuinely different:
 *
 *   the ROLE grid   what every `manager` may do. Read-only here, because
 *                   changing it changes it for everyone who will ever hold that
 *                   role, and that is a deploy, not a click.
 *   the EXCEPTIONS  what THIS person may do that their role does not say.
 *                   Editable, one decision at a time.
 *
 * Keeping them on one screen is the point: an exception only makes sense
 * against the default it departs from, and a separate "overrides" page would
 * show a list of decisions with nothing to compare them to.
 *
 * THE CATALOGUE IS IMPORTED, NOT FETCHED. It is application code, identical in
 * every deployment. Serialising it through the API would create a second copy
 * that can lag a deploy — the exact failure this phase exists to end. Only the
 * people and their exceptions come over the wire.
 *
 * WHY EACH CELL SAYS WHAT IT SAYS. A tick that means "by role" and a tick that
 * means "granted specially to this person" are different facts, and colouring
 * them the same would hide every exception in the organization behind a wall of
 * identical ticks. Overridden cells are the only ones with a border.
 */

const STATE = {
  GRANTED_BY_ROLE: "role",
  GRANTED_BY_OVERRIDE: "grant",
  DENIED_BY_OVERRIDE: "deny",
  NOT_HELD: "none",
};

function cellState(permissionKey, member, override) {
  if (override === true) return STATE.GRANTED_BY_OVERRIDE;
  if (override === false) return STATE.DENIED_BY_OVERRIDE;
  return member.roleGrants.includes(permissionKey) ? STATE.GRANTED_BY_ROLE : STATE.NOT_HELD;
}

const CELL = {
  [STATE.GRANTED_BY_ROLE]: {
    icon: Check,
    className: "text-emerald-600 dark:text-emerald-400",
    label: "Allowed by their role",
  },
  [STATE.GRANTED_BY_OVERRIDE]: {
    icon: Check,
    className:
      "text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/60 rounded bg-emerald-500/10",
    label: "Granted to this person specifically",
  },
  [STATE.DENIED_BY_OVERRIDE]: {
    icon: X,
    className:
      "text-destructive ring-1 ring-destructive/60 rounded bg-destructive/10",
    label: "Denied to this person specifically",
  },
  [STATE.NOT_HELD]: {
    icon: Minus,
    className: "text-muted-foreground/40",
    label: "Not allowed",
  },
};

/** role → { permissionKey → true }, for the read-only defaults grid. */
function roleGrid(roles) {
  return roles.map((role) => ({
    role,
    holds: new Set(PERMISSIONS.filter((p) => p.roles.includes(role)).map((p) => p.key)),
  }));
}

export default function PermissionsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [module, setModule] = useState(PERMISSION_MODULES[0]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch("/api/admin/permissions");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load permissions.");
      setData(body);
      setSelectedId((current) => current || body.members?.[0]?.id || null);
    } catch (e) {
      setError(e?.message || "Could not load permissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** membershipId → { key → boolean } */
  const overridesByMember = useMemo(() => {
    const out = new Map();
    for (const row of data?.overrides || []) {
      const forMember = out.get(row.membership_id) || {};
      forMember[row.permission_key] = row.allowed;
      out.set(row.membership_id, forMember);
    }
    return out;
  }, [data]);

  const members = data?.members || [];
  const selected = members.find((m) => m.id === selectedId) || null;
  const selectedOverrides = overridesByMember.get(selectedId) || {};
  const visible = useMemo(() => PERMISSIONS.filter((p) => p.module === module), [module]);

  const setOverride = useCallback(
    async (permissionKey, allowed) => {
      if (!selected) return;
      setSaving(permissionKey);
      try {
        const res = await authFetch("/api/admin/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ membershipId: selected.id, permissionKey, allowed }),
        });
        const body = await res.json().catch(() => ({}));
        // authFetch resolves on a 4xx, so the status has to be inspected —
        // otherwise a 403 renders as a successful save.
        if (!res.ok) throw new Error(body?.error || "Could not save.");
        await load();
        showSuccess(allowed === null ? "Exception removed" : "Saved");
      } catch (e) {
        showError(e?.message || "Could not save the exception.");
      } finally {
        setSaving(null);
      }
    },
    [selected, load]
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={sectionTitle("permissions", "admin")} />
        <SkeletonTable rows={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={sectionTitle("permissions", "admin")} />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionTitle("permissions", "admin")}
        description="What each role may do, and the exceptions written against individual people."
      />

      {data?.storeReady === false && (
        <Alert variant="warning">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Exceptions are not switched on yet</AlertTitle>
          <AlertDescription>
            The role defaults below are live and enforced. Per-person exceptions
            need <code>database/069_user_permission_overrides.sql</code> to be
            run first — until then this screen is read-only.
          </AlertDescription>
        </Alert>
      )}

      <Section
        title="What each role may do"
        description="Shipped defaults. Changing these changes them for everyone who holds the role, so they live in code rather than behind a button."
      >
        <RoleGrid module={module} onModule={setModule} />
      </Section>

      <Section
        title="Exceptions"
        description="One decision about one permission for one person. A denial always wins, including over an owner's role."
      >
        {members.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No members yet"
            description="Invite somebody first — exceptions are written against a person."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
            <MemberList
              members={members}
              selectedId={selectedId}
              onSelect={setSelectedId}
              overridesByMember={overridesByMember}
            />
            {selected && (
              <PersonPermissions
                member={selected}
                overrides={selectedOverrides}
                permissions={visible}
                module={module}
                onModule={setModule}
                onSet={setOverride}
                saving={saving}
                disabled={data?.storeReady === false}
              />
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function ModuleTabs({ module, onModule }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Permission group">
      {PERMISSION_MODULES.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={name === module}
          onClick={() => onModule(name)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
            name === module
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

/** The shipped defaults. Read-only, and says so rather than showing dead controls. */
function RoleGrid({ module, onModule }) {
  const roles = useMemo(() => {
    // Only roles that hold something in this module — a column of dashes for a
    // role that was never meant to have any of it is noise, not information.
    const inModule = PERMISSIONS.filter((p) => p.module === module);
    const all = new Set(inModule.flatMap((p) => p.roles));
    return roleGrid([...all]);
  }, [module]);
  const rows = useMemo(() => PERMISSIONS.filter((p) => p.module === module), [module]);

  return (
    <div className="space-y-3">
      <ModuleTabs module={module} onModule={onModule} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Permission
              </th>
              {roles.map(({ role }) => (
                <th
                  key={role}
                  className="px-2 py-2 text-center font-medium text-muted-foreground whitespace-nowrap"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.key} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.label}</div>
                  <code className="text-xs text-muted-foreground">{p.key}</code>
                </td>
                {roles.map(({ role, holds }) => (
                  <td key={role} className="px-2 py-2 text-center">
                    {holds.has(p.key) ? (
                      <Check
                        className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400"
                        aria-label={`${role} is allowed`}
                      />
                    ) : (
                      <Minus
                        className="mx-auto h-4 w-4 text-muted-foreground/40"
                        aria-label={`${role} is not allowed`}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemberList({ members, selectedId, onSelect, overridesByMember }) {
  return (
    <div className="rounded-lg border border-border divide-y divide-border max-h-[32rem] overflow-y-auto">
      {members.map((m) => {
        const count = Object.keys(overridesByMember.get(m.id) || {}).length;
        const active = m.id === selectedId;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-current={active ? "true" : undefined}
            className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors ${
              active ? "bg-muted" : "hover:bg-muted/50"
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{m.email}</span>
              <span className="block text-xs text-muted-foreground">
                {m.role}
                {m.status !== "active" && ` · ${m.status}`}
              </span>
            </span>
            {count > 0 && (
              <Badge variant="secondary" className="shrink-0">
                {count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PersonPermissions({
  member,
  overrides,
  permissions,
  module,
  onModule,
  onSet,
  saving,
  disabled,
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{member.email}</div>
          <div className="text-xs text-muted-foreground">
            Role: {member.role} — everything below is measured against what that role allows.
          </div>
        </div>
        <ModuleTabs module={module} onModule={onModule} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Permission
              </th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                Now
              </th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                Exception
              </th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => {
              const override = overrides[p.key];
              const state = cellState(p.key, member, override);
              const meta = CELL[state];
              const Icon = meta.icon;
              const byRole = member.roleGrants.includes(p.key);
              const busy = saving === p.key;
              return (
                <tr key={p.key} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.label}</div>
                    <code className="text-xs text-muted-foreground">{p.key}</code>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-center" title={meta.label}>
                      <Icon className={`h-4 w-4 ${meta.className}`} aria-label={meta.label} />
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant={override === true ? "default" : "outline"}
                        disabled={disabled || busy || (byRole && override === undefined)}
                        onClick={() => onSet(p.key, true)}
                        title={
                          byRole && override === undefined
                            ? "Their role already allows this"
                            : "Grant this to them specifically"
                        }
                      >
                        Allow
                      </Button>
                      <Button
                        size="sm"
                        variant={override === false ? "destructive" : "outline"}
                        disabled={disabled || busy}
                        onClick={() => onSet(p.key, false)}
                        title="Deny this to them, whatever their role says"
                      >
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled || busy || override === undefined}
                        onClick={() => onSet(p.key, null)}
                        title="Remove the exception and go back to their role"
                      >
                        Clear
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        A denial always wins, including over an owner&rsquo;s role. Clearing an
        exception returns the person to whatever their role allows —{" "}
        {defaultRolesFor("permissions.manage").join(", ")} may edit this screen.
      </p>
    </div>
  );
}
