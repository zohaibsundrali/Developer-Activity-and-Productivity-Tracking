"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { authFetch } from "@/utils/authFetch";
import { openWorkspace } from "@/utils/openWorkspace";

const WorkspacesContext = createContext(null);
export const useWorkspaces = () => useContext(WorkspacesContext);

export function WorkspacesProvider({ user, children }) {
  const isOwner = user?.membership_role === "owner";
  const [organizations, setOrganizations] = useState(null);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(null);
  const [switchError, setSwitchError] = useState("");
  const inFlight = useRef(null);
  const switchInFlight = useRef(false);

  const refresh = useCallback(() => {
    if (!isOwner) return Promise.resolve([]);
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const response = await authFetch("/api/organizations", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.organizations)) {
          throw new Error(result.error || "Your organizations could not be loaded.");
        }
        // One entry per organization; prefer the current typed membership.
        const byId = new Map();
        for (const org of result.organizations) {
          const current = org.id === user.organization_id && org.profileId === user.id && org.userType === user.role;
          const existing = byId.get(org.id);
          if (!existing || current || (org.id !== user.organization_id && org.role === "owner" && existing.role !== "owner")) byId.set(org.id, org);
        }
        const rows = [...byId.values()];
        setOrganizations(rows);
        setError("");
        return rows;
      } catch (err) {
        setError(err.message || "Your organizations could not be loaded.");
        throw err;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [isOwner, user?.id, user?.organization_id, user?.role]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const switchTo = async (organizationId) => {
    if (switchInFlight.current || organizationId === user?.organization_id) return;
    const org = organizations?.find(item => item.id === organizationId);
    if (!org) return;
    switchInFlight.current = true;
    setSwitching(org);
    setSwitchError("");
    try {
      await openWorkspace({ organizationId: org.id, profileId: org.profileId, userType: org.userType });
    } catch (err) {
      // Selection may already have invalidated the old session. Keep the old
      // dashboard unmounted until the chooser establishes a verified workspace.
      setSwitchError(err.message || "The organization could not be opened.");
    }
  };

  if (switching) return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">Opening {switching.name}</h1>
        {switchError ? <>
          <p role="alert" className="mt-3 text-sm text-destructive">{switchError}</p>
          <a href="/organizations" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Choose an organization</a>
        </> : <p role="status" className="mt-3 text-sm text-muted-foreground">Switching your workspace…</p>}
      </div>
    </main>
  );

  return <WorkspacesContext.Provider value={{ isOwner, organizations, error, refresh, switchTo, activeId: user?.organization_id, activeName: user?.organization_name }}>
    {children}
  </WorkspacesContext.Provider>;
}
