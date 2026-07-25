"use client";

import { useMemo } from "react";
import { User, Mail, Building2, LogOut, ShieldCheck } from "lucide-react";
import { showConfirm } from "@/utils/alerts";

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
    <div className="space-y-8">
      {/* Profile header */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="h-1.5 bg-primary" />
        <div className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-foreground">{name}</h2>
            <p className="text-sm text-muted-foreground break-words">{email}</p>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Account Information
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Your profile details.</p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <DetailTile icon={User} label="Name" value={name} />
          <DetailTile icon={Mail} label="Email" value={email} />
          <DetailTile icon={Building2} label="Company" value={company} />
        </div>
      </div>

      {/* Logout */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Session</h3>
            <p className="mt-1 text-sm text-muted-foreground">Sign out of the client portal on this device.</p>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center justify-center rounded-lg bg-destructive/10 px-5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground break-words">{value}</p>
    </div>
  );
}
