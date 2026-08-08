"use client";

import { useMemo } from "react";
import { User, Mail, Building2, LogOut } from "lucide-react";
import { showConfirm } from "@/utils/alerts";
import { Button } from "@/components/ui";
import { ClientPage, Panel, surface } from "./ClientShared";

const normalize = (value) => (typeof value === "string" ? value.trim() : "");

export default function ClientAccount({ user, onLogout }) {
  const name = useMemo(() => normalize(user?.name) || normalize(user?.full_name) || "—", [user]);
  const email = useMemo(() => normalize(user?.email) || "—", [user]);
  const company = useMemo(
    () => normalize(user?.company) || normalize(user?.organization_name) || "—",
    [user]
  );

  const initial = (name && name !== "—" ? name : "U").charAt(0).toUpperCase();

  const handleLogout = async () => {
    const confirmed = await showConfirm("Log out?", "You will need to sign in again to access your portal.", {
      confirmButtonText: "Log out",
    });
    if (confirmed) onLogout?.();
  };

  return (
    <ClientPage title="Account" description="Your profile details and session">
      {/* Profile */}
      <Panel className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
          {initial}
        </div>
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{name}</h2>
          <p className="break-words text-[15px] text-muted-foreground">{email}</p>
        </div>
      </Panel>

      {/* Details */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DetailTile icon={User} label="Name" value={name} />
        <DetailTile icon={Mail} label="Email" value={email} />
        <DetailTile icon={Building2} label="Company" value={company} />
      </div>

      {/* Session */}
      <Panel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Session</h2>
          <p className="text-[15px] text-muted-foreground">Sign out of the client portal on this device.</p>
        </div>
        <Button variant="destructive" size="lg" onClick={handleLogout} className="shrink-0">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </Button>
      </Panel>
    </ClientPage>
  );
}

function DetailTile({ icon: Icon, label, value }) {
  return (
    <div className={`${surface} p-5`}>
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-[15px] font-semibold text-foreground">{value}</p>
    </div>
  );
}
