"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { showSuccess, showError, showConfirm } from "@/utils/alerts";
import {
  Handshake, Link2, Megaphone, Receipt, CheckSquare, LifeBuoy, Mail, Plus,
  Trash2, Copy, RefreshCw, Send, Building2, MessageSquare, Upload, FileText, Check,
} from "lucide-react";

// Fire a best-effort client email notification. Never throws / never blocks the UI.
async function notifyClients(payload) {
  try {
    await authFetch("/api/notify/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* email is best-effort */
  }
}

const TABS = [
  { id: "clients", label: "Clients", icon: Handshake },
  { id: "links", label: "Project links", icon: Link2 },
  { id: "announcements", label: "Announcements", icon: Megaphone },
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "approvals", label: "Approvals", icon: CheckSquare },
  { id: "support", label: "Support", icon: LifeBuoy },
];

const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "void"];
const APPROVAL_ITEM_TYPES = ["deliverable", "milestone", "invoice", "general"];

// Read the logged-in admin identity (id + display name) for author/sender stamps.
function readAdmin() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("adminUser");
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { id: s.id || null, name: s.full_name || s.email || "Admin", email: s.email || null };
  } catch {
    return null;
  }
}

const statusPill = (s) => {
  const v = String(s || "").toLowerCase();
  if (["active", "paid", "approved", "open"].includes(v)) return "bg-success/10 text-success";
  if (["pending", "sent", "draft"].includes(v)) return "bg-warning/10 text-warning";
  if (["inactive", "rejected", "overdue", "void", "closed"].includes(v)) return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
};

const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return "—"; }
};

const fmtDateTime = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return "—"; }
};

export default function ClientManagement() {
  // Read org context after mount only — reading window/sessionStorage during
  // render causes a server/client hydration mismatch.
  const [orgId, setOrgId] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [orgReady, setOrgReady] = useState(false);
  const [tab, setTab] = useState("clients");
  const [loading, setLoading] = useState(false);

  const [clients, setClients] = useState([]);
  const [clientInvites, setClientInvites] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectClients, setProjectClients] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [threads, setThreads] = useState([]);

  useEffect(() => {
    setOrgId(getOrgId());
    setCtx(getOrgContext());
    setAdmin(readAdmin());
    setOrgReady(true);
  }, []);

  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [cl, pc, prj, ann, inv, apr, thr] = await Promise.all([
        // Never select("*") here: clients carries a legacy plaintext `password`
        // column, and a wildcard shipped every client's credential into the
        // admin's browser on each load of this screen. The UI reads only these.
        supabase.from("clients").select("id, name, email, company, status, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("project_clients").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("projects").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("announcements").select("*").eq("organization_id", orgId).order("published_at", { ascending: false }).limit(2000),
        supabase.from("invoices").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("approvals").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("support_threads").select("*").eq("organization_id", orgId).order("last_message_at", { ascending: false }).limit(2000),
      ]);
      setClients(cl.data || []);
      setProjectClients(pc.data || []);
      setProjects(prj.data || []);
      setAnnouncements(ann.data || []);
      setInvoices(inv.data || []);
      setApprovals(apr.data || []);
      setThreads(thr.data || []);

      // Pending client invitations come from the authenticated invitations API.
      try {
        const res = await authFetch("/api/invitations");
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setClientInvites((data.invitations || []).filter((i) => i.role === "client"));
        } else {
          setClientInvites([]);
        }
      } catch {
        setClientInvites([]);
      }
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
        Loading clients…
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
          <h2 className="text-xl font-bold tracking-tight text-foreground">Clients</h2>
          <p className="text-sm text-muted-foreground">
            {ctx?.organizationName || "Your workspace"} · invite clients, link projects &amp; manage portal content
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

      {tab === "clients" && (
        <ClientsTab clients={clients} invites={clientInvites} projects={projects} reload={loadAll} />
      )}
      {tab === "links" && (
        <ClientLinksTab orgId={orgId} clients={clients} projects={projects} links={projectClients} reload={loadAll} />
      )}
      {tab === "announcements" && (
        <ClientAnnouncementsTab orgId={orgId} admin={admin} projects={projects} announcements={announcements} reload={loadAll} />
      )}
      {tab === "invoices" && (
        <ClientInvoicesTab orgId={orgId} admin={admin} clients={clients} projects={projects} invoices={invoices} reload={loadAll} />
      )}
      {tab === "approvals" && (
        <ClientApprovalsTab orgId={orgId} admin={admin} clients={clients} projects={projects} links={projectClients} approvals={approvals} reload={loadAll} />
      )}
      {tab === "support" && (
        <ClientSupportTab orgId={orgId} admin={admin} clients={clients} threads={threads} reload={loadAll} />
      )}
    </div>
  );
}

/* ---------------- Clients ---------------- */
function ClientsTab({ clients, invites, projects, reload }) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState([]); // project ids to link on accept
  const [sending, setSending] = useState(false);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const invite = async (e) => {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;

    // Prevent a duplicate pending invite or inviting an existing client.
    if (invites.some((inv) => inv.status === "pending" && (inv.email || "").toLowerCase() === target)) {
      showError("Already invited", `${email.trim()} already has a pending client invitation.`);
      return;
    }
    if (clients.some((c) => (c.email || "").toLowerCase() === target)) {
      showError("Already a client", `${email.trim()} is already a client in this workspace.`);
      return;
    }

    setSending(true);
    try {
      // Send ONE invitation. It carries the first selected project, which is
      // linked automatically when the client accepts. A client account only
      // exists after acceptance, so any ADDITIONAL projects are linked
      // afterwards from the "Project links" tab (sending a second invite for the
      // same email would fail once the account exists).
      const primaryProject = selected[0] || null;
      const extraCount = Math.max(0, selected.length - 1);
      const res = await authFetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role: "client", projectId: primaryProject }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to create invitation");

      setEmail(""); setSelected([]);
      showSuccess(
        "Client invited",
        (data.emailed
          ? `Invite emailed to ${email.trim()}.`
          : "Invite created. Share the link from the list below.") +
          (extraCount > 0
            ? ` Link the other ${extraCount} project${extraCount > 1 ? "s" : ""} from “Project links” once they accept.`
            : "")
      );
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not send client invitation.");
    } finally { setSending(false); }
  };

  const copyLink = (inv) => {
    const link = `${window.location.origin}/invite/${inv.token}`;
    navigator.clipboard?.writeText(link);
    showSuccess("Link copied", link);
  };

  const revoke = async (inv) => {
    const ok = await showConfirm("Revoke invitation?", `Revoke client invite for ${inv.email}?`);
    if (!ok) return;
    await supabase.from("invitations").update({ status: "revoked" }).eq("id", inv.id);
    reload();
  };

  const projName = (id) => projects.find((p) => p.id === id)?.name || "—";
  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={invite} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Mail className="h-4 w-4 text-primary" /> Invite a client
        </h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@company.com" required
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Link projects (optional)</label>
        <div className="mb-3 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-input bg-background p-2">
          {projects.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No projects yet.</p>
          ) : projects.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary/30" />
              <span className="truncate text-foreground">{p.name}</span>
            </label>
          ))}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Selected projects are linked automatically when the client accepts. You can add or remove links later under “Project links”.
        </p>
        <button disabled={sending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Mail className="h-4 w-4" /> {sending ? "Sending…" : "Send invitation"}
        </button>
      </form>

      <div className="space-y-5 lg:col-span-2">
        {/* Existing clients */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Clients</h3>
          {clients.length === 0 ? (
            <EmptyCard label="No clients yet" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{c.name || "—"}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{c.company || "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(c.status)}`}>{c.status || "active"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending client invitations */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Pending invitations</h3>
          {pendingInvites.length === 0 ? (
            <EmptyCard label="No pending client invitations" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingInvites.map((inv) => (
                    <tr key={inv.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{inv.email}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{inv.project_id ? projName(inv.project_id) : "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(inv.status)}`}>{inv.status}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => copyLink(inv)} title="Copy invite link" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                            <Copy className="h-4 w-4" />
                          </button>
                          <button onClick={() => revoke(inv)} title="Revoke" className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
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
    </div>
  );
}

/* ---------------- Project links ---------------- */
function ClientLinksTab({ orgId, clients, projects, links, reload }) {
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  const clientName = (id) => {
    const c = clients.find((x) => x.id === id);
    return c ? (c.name || c.email) : "—";
  };
  const projName = (id) => projects.find((p) => p.id === id)?.name || "—";

  const add = async (e) => {
    e.preventDefault();
    if (!clientId || !projectId) {
      showError("Missing selection", "Pick both a client and a project.");
      return;
    }
    if (links.some((l) => l.client_id === clientId && l.project_id === projectId)) {
      showError("Already linked", `${clientName(clientId)} is already linked to ${projName(projectId)}.`);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("project_clients").insert([{
        organization_id: orgId, client_id: clientId, project_id: projectId,
      }]);
      if (error) throw error;
      setProjectId("");
      showSuccess("Linked", `${clientName(clientId)} linked to ${projName(projectId)}.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not link client to project.");
    } finally { setSaving(false); }
  };

  const unlink = async (l) => {
    const ok = await showConfirm("Remove link?", `Unlink ${clientName(l.client_id)} from ${projName(l.project_id)}?`);
    if (!ok) return;
    await supabase.from("project_clients").delete().eq("id", l.id);
    reload();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={add} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Link2 className="h-4 w-4 text-primary" /> Link a client to a project
        </h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— Select client —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
        </select>
        <label className="mb-1 block text-xs font-medium text-foreground">Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— Select project —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? "Linking…" : "Add link"}
        </button>
      </form>

      <div className="lg:col-span-2">
        {links.length === 0 ? (
          <EmptyCard label="No client-project links yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{clientName(l.client_id)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{projName(l.project_id)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button onClick={() => unlink(l)} title="Unlink" className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
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

/* ---------------- Announcements ---------------- */
function ClientAnnouncementsTab({ orgId, admin, projects, announcements, reload }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  const projName = (id) => projects.find((p) => p.id === id)?.name || null;

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("announcements").insert([{
        organization_id: orgId,
        project_id: projectId || null,
        title: title.trim(),
        body: body.trim() || null,
        author_name: admin?.name || null,
        created_by: admin?.id || null,
        published_at: new Date().toISOString(),
      }]);
      if (error) throw error;
      const t = title.trim();
      notifyClients({ kind: "announcement", title: t, message: body.trim() || null, projectId: projectId || null });
      setTitle(""); setBody(""); setProjectId("");
      showSuccess("Announcement published", `"${t}" is now visible to clients.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not publish announcement.");
    } finally { setSaving(false); }
  };

  const remove = async (a) => {
    const ok = await showConfirm("Delete announcement?", `Remove "${a.title}"?`);
    if (!ok) return;
    await supabase.from("announcements").delete().eq("id", a.id);
    reload();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={add} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Megaphone className="h-4 w-4 text-primary" /> New announcement
        </h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint 3 shipped" required
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Body</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What’s new for the client…"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— Org-wide (all clients) —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? "Publishing…" : "Publish"}
        </button>
      </form>

      <div className="lg:col-span-2">
        {announcements.length === 0 ? (
          <EmptyCard label="No announcements yet" />
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{a.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body || "—"}</p>
                  </div>
                  <button onClick={() => remove(a)} title="Delete" className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
                    <Building2 className="h-3.5 w-3.5" /> {a.project_id ? (projName(a.project_id) || "Project") : "Org-wide"}
                  </span>
                  <span>By {a.author_name || "—"}</span>
                  <span>· {fmtDateTime(a.published_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Invoices ---------------- */
function ClientInvoicesTab({ orgId, admin, clients, projects, invoices, reload }) {
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState("draft");
  const [issuedAt, setIssuedAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const clientName = (id) => {
    const c = clients.find((x) => x.id === id);
    return c ? (c.name || c.email) : "—";
  };
  const projName = (id) => projects.find((p) => p.id === id)?.name || "—";

  // Upload a PDF to the private `invoices` storage bucket and stamp pdf_path.
  // The client-side /api/client/invoices/[id]/pdf route signs this same path.
  const uploadInvoicePdf = async (invoiceId, file) => {
    const clean = file.name.replace(/[^a-zA-Z0-9.\-]/g, "_");
    const path = `${orgId}/${invoiceId}/${Date.now()}_${clean}`;
    const { error: upErr } = await supabase.storage
      .from("invoices")
      .upload(path, file, { upsert: true, contentType: file.type || "application/pdf" });
    if (upErr) {
      if (/bucket/i.test(upErr.message) && /not found/i.test(upErr.message)) {
        throw new Error("Create a PRIVATE storage bucket named 'invoices' in Supabase first.");
      }
      throw upErr;
    }
    const { error: updErr } = await supabase.from("invoices").update({ pdf_path: path }).eq("id", invoiceId);
    if (updErr) throw updErr;
    return path;
  };

  const add = async (e) => {
    e.preventDefault();
    if (!number.trim()) {
      showError("Missing number", "An invoice number is required.");
      return;
    }
    setSaving(true);
    try {
      const { data: inserted, error } = await supabase.from("invoices").insert([{
        organization_id: orgId,
        client_id: clientId || null,
        project_id: projectId || null,
        number: number.trim(),
        title: title.trim() || null,
        amount: amount ? Number(amount) : 0,
        currency: currency || "USD",
        status,
        issued_at: issuedAt ? new Date(issuedAt).toISOString() : null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        created_by: admin?.id || null,
      }]).select("id").single();
      if (error) throw error;

      if (pdfFile && inserted?.id) {
        try {
          await uploadInvoicePdf(inserted.id, pdfFile);
        } catch (upErr) {
          showError("PDF upload failed", `Invoice saved, but the PDF didn't attach: ${upErr.message}`);
        }
      }

      // Clients can't see drafts, so only notify for non-draft invoices.
      if (status !== "draft") {
        notifyClients({
          kind: "invoice",
          title: `Invoice ${number.trim()}`,
          message: `${currency || "USD"} ${(amount ? Number(amount) : 0).toFixed(2)}${title.trim() ? ` — ${title.trim()}` : ""}`,
          clientId: clientId || null,
          projectId: projectId || null,
        });
      }

      setClientId(""); setProjectId(""); setNumber(""); setTitle(""); setAmount("");
      setCurrency("USD"); setStatus("draft"); setIssuedAt(""); setDueAt(""); setPdfFile(null);
      showSuccess("Invoice created", `Invoice ${number.trim()} added.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not create invoice.");
    } finally { setSaving(false); }
  };

  const changeStatus = async (inv, next) => {
    const { error } = await supabase.from("invoices").update({ status: next }).eq("id", inv.id);
    if (error) { showError("Update failed", error.message || "Could not update invoice."); return; }
    // Notify the client when an invoice moves out of draft (becomes visible).
    if (inv.status === "draft" && next !== "draft") {
      notifyClients({
        kind: "invoice",
        title: `Invoice ${inv.number}`,
        message: `${inv.currency || "USD"} ${Number(inv.amount || 0).toFixed(2)}`,
        clientId: inv.client_id || null,
        projectId: inv.project_id || null,
      });
    }
    reload();
  };

  const onRowUpload = async (inv, file) => {
    if (!file) return;
    setBusyId(inv.id);
    try {
      await uploadInvoicePdf(inv.id, file);
      showSuccess("PDF attached", `PDF added to invoice ${inv.number}.`);
      reload();
    } catch (err) {
      showError("Upload failed", err.message || "Could not upload the PDF.");
    } finally { setBusyId(null); }
  };

  const money = (inv) => `${inv.currency || "USD"} ${Number(inv.amount || 0).toFixed(2)}`;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={add} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Receipt className="h-4 w-4 text-primary" /> New invoice
        </h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— None —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
        </select>
        <label className="mb-1 block text-xs font-medium text-foreground">Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— None —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Number</label>
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-001" required
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" maxLength={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        <label className="mb-1 block text-xs font-medium text-foreground">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Milestone 1 payment"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Amount</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
              {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Issued</label>
            <input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Due</label>
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        <label className="mb-1 block text-xs font-medium text-foreground">PDF (optional)</label>
        <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input bg-background px-3 py-2 text-sm text-muted-foreground hover:border-primary">
          <Upload className="h-4 w-4" />
          <span className="truncate">{pdfFile ? pdfFile.name : "Attach an invoice PDF"}</span>
          <input type="file" accept="application/pdf" className="hidden"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)} />
        </label>
        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? "Creating…" : "Create invoice"}
        </button>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          PDF needs a private Supabase storage bucket named <code>invoices</code>.
        </p>
      </form>

      <div className="lg:col-span-2">
        {invoices.length === 0 ? (
          <EmptyCard label="No invoices yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Number</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Due</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{inv.number}</p>
                      <p className="text-xs text-muted-foreground">{inv.title || projName(inv.project_id)}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{inv.client_id ? clientName(inv.client_id) : "—"}</td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{money(inv)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(inv.due_at)}</td>
                    <td className="px-4 py-3">
                      <select value={inv.status} onChange={(e) => changeStatus(inv, e.target.value)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold outline-none ${statusPill(inv.status)}`}>
                        {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={inv.pdf_path ? "Replace PDF" : "Attach PDF"}>
                        {busyId === inv.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : inv.pdf_path ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {inv.pdf_path ? "PDF" : "Upload"}
                        <input type="file" accept="application/pdf" className="hidden"
                          disabled={busyId === inv.id}
                          onChange={(e) => onRowUpload(inv, e.target.files?.[0] || null)} />
                      </label>
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

/* ---------------- Approvals ---------------- */
function ClientApprovalsTab({ orgId, admin, clients, projects, links, approvals, reload }) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("deliverable");
  const [itemRef, setItemRef] = useState("");
  const [saving, setSaving] = useState(false);

  const projName = (id) => projects.find((p) => p.id === id)?.name || "—";

  // Clients linked to a given project (for a hint of who will see the request).
  const clientsForProject = (pid) => {
    const ids = links.filter((l) => l.project_id === pid).map((l) => l.client_id);
    return clients.filter((c) => ids.includes(c.id));
  };

  const add = async (e) => {
    e.preventDefault();
    if (!projectId) { showError("Missing project", "Pick the project this approval is for."); return; }
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("approvals").insert([{
        organization_id: orgId,
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || null,
        item_type: itemType,
        item_ref: itemRef.trim() || null,
        status: "pending",
        created_by: admin?.id || null,
      }]);
      if (error) throw error;
      const t = title.trim();
      notifyClients({ kind: "approval", title: t, message: description.trim() || null, projectId });
      setProjectId(""); setTitle(""); setDescription(""); setItemType("deliverable"); setItemRef("");
      showSuccess("Approval requested", `"${t}" sent to the client.`);
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not create approval request.");
    } finally { setSaving(false); }
  };

  const remove = async (a) => {
    const ok = await showConfirm("Delete approval?", `Remove "${a.title}"?`);
    if (!ok) return;
    await supabase.from("approvals").delete().eq("id", a.id);
    reload();
  };

  const linkedClients = projectId ? clientsForProject(projectId) : [];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <form onSubmit={add} className="rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-1">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckSquare className="h-4 w-4 text-primary" /> Request approval
        </h3>
        <label className="mb-1 block text-xs font-medium text-foreground">Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
          className="mb-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          <option value="">— Select project —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {projectId && (
          <p className="mb-3 text-xs text-muted-foreground">
            {linkedClients.length
              ? `Visible to: ${linkedClients.map((c) => c.name || c.email).join(", ")}`
              : "No clients linked to this project yet — link one under “Project links”."}
          </p>
        )}
        <label className="mb-1 block text-xs font-medium text-foreground">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Homepage design v2" required
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What needs sign-off…"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <label className="mb-1 block text-xs font-medium text-foreground">Item type</label>
        <select value={itemType} onChange={(e) => setItemType(e.target.value)}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30">
          {APPROVAL_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="mb-1 block text-xs font-medium text-foreground">Item reference (optional)</label>
        <input value={itemRef} onChange={(e) => setItemRef(e.target.value)} placeholder="UUID of referenced item"
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {saving ? "Sending…" : "Request approval"}
        </button>
      </form>

      <div className="lg:col-span-2">
        {approvals.length === 0 ? (
          <EmptyCard label="No approval requests yet" />
        ) : (
          <div className="space-y-3">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-foreground">{a.title}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(a.status)}`}>{a.status}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.description || "—"}</p>
                  </div>
                  <button onClick={() => remove(a)} title="Delete" className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
                    <Building2 className="h-3.5 w-3.5" /> {projName(a.project_id)}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 font-medium capitalize">{a.item_type}</span>
                  <span>Requested {fmtDate(a.created_at)}</span>
                  {a.decided_at && <span>· Decided {fmtDate(a.decided_at)}</span>}
                  {a.note && <span className="italic">“{a.note}”</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Support ---------------- */
function ClientSupportTab({ orgId, admin, clients, threads, reload }) {
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeId) || null, [threads, activeId]);
  const clientName = (id) => {
    const c = clients.find((x) => x.id === id);
    return c ? (c.name || c.email) : "Client";
  };

  const openThread = useCallback(async (t) => {
    setActiveId(t.id);
    setLoadingMsgs(true);
    try {
      const { data } = await supabase
        .from("support_messages")
        .select("*")
        .eq("thread_id", t.id)
        .order("created_at", { ascending: true });
      setMessages(data || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  const send = async (e) => {
    e.preventDefault();
    if (!reply.trim() || !activeThread) return;
    setSending(true);
    try {
      const nowIso = new Date().toISOString();
      const { data: msg, error } = await supabase.from("support_messages").insert([{
        organization_id: orgId,
        thread_id: activeThread.id,
        sender_type: "agency",
        sender_id: admin?.id || null,
        sender_name: admin?.name || "Agency",
        body: reply.trim(),
      }]).select("*").single();
      if (error) throw error;
      await supabase.from("support_threads").update({ last_message_at: nowIso }).eq("id", activeThread.id);
      setMessages((prev) => [...prev, msg]);
      setReply("");
      reload();
    } catch (err) {
      showError("Failed", err.message || "Could not send reply.");
    } finally { setSending(false); }
  };

  const toggleStatus = async (t) => {
    const next = t.status === "open" ? "closed" : "open";
    const { error } = await supabase.from("support_threads").update({ status: next }).eq("id", t.id);
    if (error) { showError("Update failed", error.message || "Could not update thread."); return; }
    reload();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Threads list */}
      <div className="lg:col-span-1">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Support threads</h3>
        {threads.length === 0 ? (
          <EmptyCard label="No support threads yet" />
        ) : (
          <div className="space-y-2">
            {threads.map((t) => {
              const active = t.id === activeId;
              return (
                <button key={t.id} onClick={() => openThread(t)}
                  className={`w-full rounded-xl border p-3 text-left shadow-card transition-colors ${
                    active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{t.subject}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill(t.status)}`}>{t.status}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{clientName(t.client_id)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(t.last_message_at)}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Conversation */}
      <div className="lg:col-span-2">
        {!activeThread ? (
          <EmptyCard label="Select a thread to read and reply" />
        ) : (
          <div className="flex h-full flex-col rounded-xl border border-border bg-card shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{activeThread.subject}</p>
                <p className="text-xs text-muted-foreground">{clientName(activeThread.client_id)}</p>
              </div>
              <button onClick={() => toggleStatus(activeThread)}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
                {activeThread.status === "open" ? "Close thread" : "Reopen"}
              </button>
            </div>

            <div className="max-h-[420px] min-h-[220px] space-y-3 overflow-y-auto p-4">
              {loadingMsgs ? (
                <p className="text-center text-sm text-muted-foreground">Loading messages…</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">No messages in this thread yet.</p>
              ) : messages.map((m) => {
                const agency = m.sender_type === "agency";
                return (
                  <div key={m.id} className={`flex ${agency ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      agency ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}>
                      <p className="mb-0.5 flex items-center gap-1 text-[11px] opacity-80">
                        <MessageSquare className="h-3 w-3" /> {m.sender_name || (agency ? "Agency" : "Client")}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-[10px] opacity-70">{fmtDateTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={send} className="flex items-end gap-2 border-t border-border p-3">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Reply as agency…"
                className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
              <button disabled={sending || !reply.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <Send className="h-4 w-4" /> {sending ? "…" : "Send"}
              </button>
            </form>
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
