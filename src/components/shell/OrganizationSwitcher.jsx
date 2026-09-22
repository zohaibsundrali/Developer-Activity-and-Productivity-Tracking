"use client";

import { Building2, ChevronDown } from "lucide-react";
import { useWorkspaces } from "@/contexts/WorkspacesContext";

export default function OrganizationSwitcher() {
  const workspaces = useWorkspaces();
  if (!workspaces?.isOwner) return null;
  const { organizations, activeId, activeName, error, refresh, switchTo } = workspaces;
  const active = organizations?.find(org => org.id === activeId);
  const name = active?.name || activeName || "Your organization";

  return <div className="flex min-w-0 max-w-64 items-center gap-2">
    <Building2 className="hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      {organizations?.length > 1 ? <div className="relative">
        <label htmlFor="active-organization" className="sr-only">Active organization</label>
        <select id="active-organization" value={activeId || ""} onChange={event => switchTo(event.target.value)}
          className="min-h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-card py-2 pl-3 pr-8 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          {!active && <option value={activeId || ""} disabled>{name}</option>}
          {organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div> : <p className="truncate text-sm font-semibold" title={name}>{name}</p>}
      {error && <button type="button" onClick={() => refresh().catch(() => {})} className="block text-left text-xs text-destructive underline">Organizations unavailable. Retry</button>}
    </div>
  </div>;
}
