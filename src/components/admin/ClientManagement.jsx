"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { showSuccess, showError, showConfirm } from "@/utils/alerts";
import {
  PageHeader, Section, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Badge, StatusPill, EmptyState, Skeleton, SkeletonTable, SkeletonList,
  ErrorState, Tabs, Field, Button, Input,
} from "@/components/ui";
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
  { id: "clients", label: "Clients" },
  { id: "links", label: "Project links" },
  { id: "announcements", label: "Announcements" },
  { id: "invoices", label: "Invoices" },
  { id: "approvals", label: "Approvals" },
  { id: "support", label: "Support" },
];

const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "void"];
// "task" links an approval to a real developer_task, which is what lets the
// client's decision be stamped back onto the board the team works from. The
// other four have no picker and still take a hand-entered reference.
const APPROVAL_ITEM_TYPES = ["task", "deliverable", "milestone", "invoice", "general"];

/* Shared presentation classes — the table/control shapes the UI kit contract asks for. */
const TABLE_SHELL = "overflow-x-auto rounded-xl border border-border bg-card shadow-card";
const TH = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TH_RIGHT = "px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TR = "h-12 transition-colors duration-150 hover:bg-muted/40";
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const CONTROL = `w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 ${FOCUS_RING}`;
const DANGER_ICON_BTN = `text-muted-foreground hover:bg-destructive/10 hover:text-destructive ${FOCUS_RING}`;

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

// Same buckets the old colour-only pill used, mapped onto StatusPill's shapes so
// status is never communicated by colour alone.
const pillStatus = (s) => {
  const v = String(s || "").toLowerCase();
  if (["active", "paid", "approved", "open"].includes(v)) return "success";
  if (["pending", "sent", "draft"].includes(v)) return "pending";
  if (["inactive", "rejected", "overdue", "void", "closed"].includes(v)) return "error";
  return "unknown";
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
  // Presentation-only: surfaces the failure the loader already caught so the
  // screen can offer a retry instead of an empty table.
  const [error, setError] = useState(null);

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
    setError(null);
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
    } catch (err) {
      setError(err?.message || "Something went wrong while loading this workspace.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!orgReady) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="rounded-xl border border-border bg-card shadow-card">
          <SkeletonTable rows={5} cols={4} />
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
    clients: clients.length,
    links: projectClients.length,
    announcements: announcements.length,
    invoices: invoices.length,
    approvals: approvals.length,
    support: threads.length,
  };
  const tabItems = TABS.map((t) => ({ ...t, count: loading ? undefined : counts[t.id] }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={`${ctx?.organizationName || "Your workspace"} · invite clients, link projects & manage portal content`}
        actions={
          <Button variant="outline" onClick={loadAll} disabled={loading}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Tabs tabs={tabItems} active={tab} onChange={setTab} aria-label="Client workspace sections" />

      <div key={tab} className="animate-fade-in motion-reduce:animate-none">
        {tab === "clients" && (
          <ClientsTab clients={clients} invites={clientInvites} projects={projects} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "links" && (
          <ClientLinksTab orgId={orgId} clients={clients} projects={projects} links={projectClients} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "announcements" && (
          <ClientAnnouncementsTab orgId={orgId} admin={admin} projects={projects} announcements={announcements} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "invoices" && (
          <ClientInvoicesTab orgId={orgId} admin={admin} clients={clients} projects={projects} invoices={invoices} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "approvals" && (
          <ClientApprovalsTab orgId={orgId} admin={admin} clients={clients} projects={projects} links={projectClients} approvals={approvals} reload={loadAll} loading={loading} loadError={error} />
        )}
        {tab === "support" && (
          <ClientSupportTab orgId={orgId} admin={admin} clients={clients} threads={threads} reload={loadAll} loading={loading} loadError={error} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Clients ---------------- */
function ClientsTab({ clients, invites, projects, reload, loading, loadError }) {
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
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail aria-hidden="true" className="h-4 w-4 text-primary" /> Invite a client
          </CardTitle>
          <CardDescription>They get portal access as soon as they accept.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={invite} className="space-y-4">
            <Field label="Email" htmlFor="client-invite-email" required>
              <Input id="client-invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="client@company.com" required />
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Link projects (optional)</p>
              <div role="group" aria-label="Projects to link on acceptance"
                className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-input bg-background p-2">
                {projects.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No projects yet.</p>
                ) : projects.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted">
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)}
                      className={`h-4 w-4 rounded border-input text-primary ${FOCUS_RING}`} />
                    <span className="truncate text-foreground">{p.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Selected projects are linked automatically when the client accepts. You can add or remove links later under “Project links”.
              </p>
            </div>

            <Button type="submit" disabled={sending} className="w-full">
              <Mail aria-hidden="true" className="h-4 w-4" /> {sending ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6 lg:col-span-2">
        {/* Existing clients */}
        <Section title="Clients" description="Everyone with access to this workspace's client portal.">
          {loadError ? (
            <ErrorState title="Couldn't load clients" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className={TABLE_SHELL}><SkeletonTable rows={4} cols={4} /></div>
          ) : clients.length === 0 ? (
            <EmptyState icon={Handshake} title="No clients yet"
              description="Invite a client with the form on the left — they appear here once they accept." />
          ) : (
            <div className={TABLE_SHELL}>
              <table className="w-full min-w-[560px] divide-y divide-border">
                <thead>
                  <tr className="bg-muted/40">
                    <th scope="col" className={TH}>Name</th>
                    <th scope="col" className={TH}>Email</th>
                    <th scope="col" className={TH}>Company</th>
                    <th scope="col" className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {clients.map((c) => (
                    <tr key={c.id} className={TR}>
                      <td className="px-4 text-sm font-medium text-foreground">{c.name || "—"}</td>
                      <td className="px-4 text-sm text-muted-foreground">{c.email}</td>
                      <td className="px-4 text-sm text-muted-foreground">{c.company || "—"}</td>
                      <td className="px-4">
                        <StatusPill status={pillStatus(c.status)} label={c.status || "active"} size="sm" className="capitalize" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Pending client invitations */}
        <Section title="Pending invitations" description="Invites that have been sent but not accepted yet.">
          {loadError ? (
            <ErrorState title="Couldn't load invitations" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className={TABLE_SHELL}><SkeletonTable rows={3} cols={4} /></div>
          ) : pendingInvites.length === 0 ? (
            <EmptyState icon={Mail} title="No pending client invitations"
              description="Every invitation you've sent has been accepted or revoked." />
          ) : (
            <div className={TABLE_SHELL}>
              <table className="w-full min-w-[560px] divide-y divide-border">
                <thead>
                  <tr className="bg-muted/40">
                    <th scope="col" className={TH}>Email</th>
                    <th scope="col" className={TH}>Project</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH_RIGHT}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pendingInvites.map((inv) => (
                    <tr key={inv.id} className={TR}>
                      <td className="px-4 text-sm font-medium text-foreground">{inv.email}</td>
                      <td className="px-4 text-sm text-muted-foreground">{inv.project_id ? projName(inv.project_id) : "—"}</td>
                      <td className="px-4">
                        <StatusPill status={pillStatus(inv.status)} label={inv.status} size="sm" className="capitalize" />
                      </td>
                      <td className="px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => copyLink(inv)}
                            title="Copy invite link" aria-label={`Copy invite link for ${inv.email}`}
                            className={`text-muted-foreground hover:text-foreground ${FOCUS_RING}`}>
                            <Copy aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => revoke(inv)}
                            title="Revoke" aria-label={`Revoke invitation for ${inv.email}`} className={DANGER_ICON_BTN}>
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
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

/* ---------------- Project links ---------------- */
function ClientLinksTab({ orgId, clients, projects, links, reload, loading, loadError }) {
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
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 aria-hidden="true" className="h-4 w-4 text-primary" /> Link a client to a project
          </CardTitle>
          <CardDescription>A client only sees the projects they are linked to.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-4">
            <Field label="Client" htmlFor="link-client">
              <select id="link-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={CONTROL}>
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
              </select>
            </Field>
            <Field label="Project" htmlFor="link-project">
              <select id="link-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={CONTROL}>
                <option value="">— Select project —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={saving} className="w-full">
              <Plus aria-hidden="true" className="h-4 w-4" /> {saving ? "Linking…" : "Add link"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Client ↔ project links" description="Who can see which project in the portal.">
          {loadError ? (
            <ErrorState title="Couldn't load project links" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className={TABLE_SHELL}><SkeletonTable rows={4} cols={4} /></div>
          ) : links.length === 0 ? (
            <EmptyState icon={Link2} title="No client-project links yet"
              description="Link a client to a project so it shows up in their portal." />
          ) : (
            <div className={TABLE_SHELL}>
              <table className="w-full min-w-[520px] divide-y divide-border">
                <thead>
                  <tr className="bg-muted/40">
                    <th scope="col" className={TH}>Client</th>
                    <th scope="col" className={TH}>Project</th>
                    <th scope="col" className={TH}>Linked</th>
                    <th scope="col" className={TH_RIGHT}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {links.map((l) => (
                    <tr key={l.id} className={TR}>
                      <td className="px-4 text-sm font-medium text-foreground">{clientName(l.client_id)}</td>
                      <td className="px-4 text-sm text-muted-foreground">{projName(l.project_id)}</td>
                      <td className="px-4 text-sm text-muted-foreground">{fmtDate(l.created_at)}</td>
                      <td className="px-4">
                        <div className="flex justify-end">
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => unlink(l)}
                            title="Unlink" aria-label={`Unlink ${clientName(l.client_id)} from ${projName(l.project_id)}`}
                            className={DANGER_ICON_BTN}>
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
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

/* ---------------- Announcements ---------------- */
function ClientAnnouncementsTab({ orgId, admin, projects, announcements, reload, loading, loadError }) {
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
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone aria-hidden="true" className="h-4 w-4 text-primary" /> New announcement
          </CardTitle>
          <CardDescription>Published straight to the client portal.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-4">
            <Field label="Title" htmlFor="ann-title" required>
              <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint 3 shipped" required />
            </Field>
            <Field label="Body" htmlFor="ann-body">
              <textarea id="ann-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4}
                placeholder="What’s new for the client…" className={CONTROL} />
            </Field>
            <Field label="Project" htmlFor="ann-project">
              <select id="ann-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={CONTROL}>
                <option value="">— Org-wide (all clients) —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={saving} className="w-full">
              <Plus aria-hidden="true" className="h-4 w-4" /> {saving ? "Publishing…" : "Publish"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Published announcements">
          {loadError ? (
            <ErrorState title="Couldn't load announcements" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className="space-y-3">
              <SkeletonList rows={3} />
            </div>
          ) : announcements.length === 0 ? (
            <EmptyState icon={Megaphone} title="No announcements yet"
              description="Publish an update and every linked client sees it in their portal." />
          ) : (
            <div className="space-y-3">
              {announcements.map((a) => (
                <Card key={a.id}>
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{a.title}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body || "—"}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(a)}
                        title="Delete" aria-label={`Delete announcement ${a.title}`}
                        className={`shrink-0 ${DANGER_ICON_BTN}`}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" size="sm">
                        <Building2 aria-hidden="true" /> {a.project_id ? (projName(a.project_id) || "Project") : "Org-wide"}
                      </Badge>
                      <span>By {a.author_name || "—"}</span>
                      <span>· {fmtDateTime(a.published_at)}</span>
                    </div>
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

/* ---------------- Invoices ---------------- */
function ClientInvoicesTab({ orgId, admin, clients, projects, invoices, reload, loading, loadError }) {
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
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt aria-hidden="true" className="h-4 w-4 text-primary" /> New invoice
          </CardTitle>
          <CardDescription>Drafts stay private until you move them out of draft.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-4">
            <Field label="Client" htmlFor="inv-client">
              <select id="inv-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={CONTROL}>
                <option value="">— None —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
              </select>
            </Field>
            <Field label="Project" htmlFor="inv-project">
              <select id="inv-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={CONTROL}>
                <option value="">— None —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Number" htmlFor="inv-number" required>
                <Input id="inv-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-001" required />
              </Field>
              <Field label="Currency" htmlFor="inv-currency">
                <Input id="inv-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="USD" maxLength={3} />
              </Field>
            </div>
            <Field label="Title" htmlFor="inv-title">
              <Input id="inv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Milestone 1 payment" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" htmlFor="inv-amount">
                <Input id="inv-amount" type="number" step="0.01" min="0" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Status" htmlFor="inv-status">
                <select id="inv-status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${CONTROL} capitalize`}>
                  {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issued" htmlFor="inv-issued">
                <Input id="inv-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </Field>
              <Field label="Due" htmlFor="inv-due">
                <Input id="inv-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </Field>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">PDF (optional)</p>
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input bg-background px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:border-primary focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background`}>
                <Upload aria-hidden="true" className="h-4 w-4" />
                <span className="truncate">{pdfFile ? pdfFile.name : "Attach an invoice PDF"}</span>
                <input type="file" accept="application/pdf" className="sr-only"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)} />
              </label>
              <p className="text-xs leading-snug text-muted-foreground">
                PDF needs a private Supabase storage bucket named <code>invoices</code>.
              </p>
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              <Plus aria-hidden="true" className="h-4 w-4" /> {saving ? "Creating…" : "Create invoice"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Invoices" description="Status changes out of draft notify the linked client.">
          {loadError ? (
            <ErrorState title="Couldn't load invoices" description={loadError} onRetry={reload} />
          ) : loading ? (
            <div className={TABLE_SHELL}><SkeletonTable rows={5} cols={6} /></div>
          ) : invoices.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices yet"
              description="Create an invoice on the left — clients see everything except drafts." />
          ) : (
            <div className={TABLE_SHELL}>
              <table className="w-full min-w-[820px] divide-y divide-border">
                <thead>
                  <tr className="bg-muted/40">
                    <th scope="col" className={TH}>Number</th>
                    <th scope="col" className={TH}>Client</th>
                    <th scope="col" className={TH}>Amount</th>
                    <th scope="col" className={TH}>Due</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className={TR}>
                      <td className="px-4 py-2">
                        <p className="text-sm font-medium text-foreground">{inv.number}</p>
                        <p className="text-xs text-muted-foreground">{inv.title || projName(inv.project_id)}</p>
                      </td>
                      <td className="px-4 text-sm text-muted-foreground">{inv.client_id ? clientName(inv.client_id) : "—"}</td>
                      <td className="px-4 text-sm font-medium text-foreground">{money(inv)}</td>
                      <td className="px-4 text-sm text-muted-foreground">{fmtDate(inv.due_at)}</td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <StatusPill status={pillStatus(inv.status)} label={inv.status} size="sm" className="capitalize" />
                          <select value={inv.status} onChange={(e) => changeStatus(inv, e.target.value)}
                            aria-label={`Change status of invoice ${inv.number}`}
                            className={`rounded-lg border border-input bg-background px-2 py-1 text-xs capitalize text-foreground transition-colors duration-150 ${FOCUS_RING}`}>
                            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="px-4">
                        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background`}
                          title={inv.pdf_path ? "Replace PDF" : "Attach PDF"}>
                          {busyId === inv.id ? (
                            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                          ) : inv.pdf_path ? (
                            <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                          )}
                          {inv.pdf_path ? "PDF" : "Upload"}
                          <input type="file" accept="application/pdf" className="sr-only"
                            aria-label={inv.pdf_path ? `Replace PDF for invoice ${inv.number}` : `Attach PDF to invoice ${inv.number}`}
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
        </Section>
      </div>
    </div>
  );
}

/* ---------------- Approvals ---------------- */
function ClientApprovalsTab({ orgId, admin, clients, projects, links, approvals, reload, loading, loadError }) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("deliverable");
  const [itemRef, setItemRef] = useState("");
  const [saving, setSaving] = useState(false);

  // Only client-visible tasks are offered. Asking a client to approve work they
  // cannot open is a dead end, and the approval routes would refuse to show it
  // to them anyway.
  const [taskOptions, setTaskOptions] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Clearing the reference here is what stops a task id chosen for one
    // project being submitted against another after the project is switched.
    setItemRef("");
    if (itemType !== "task" || !projectId) { setTaskOptions([]); return undefined; }
    setTasksLoading(true);
    supabase
      .from("developer_tasks")
      .select("id, task_title, status")
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .eq("client_visible", true)
      .order("task_order", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        setTaskOptions(data || []);
        setTasksLoading(false);
      });
    return () => { cancelled = true; };
  }, [itemType, projectId, orgId]);

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
    // A task approval with no task cannot be stamped back onto the board, which
    // is the only reason to choose this type.
    if (itemType === "task" && !itemRef) {
      showError("Pick a task", "A task approval needs the task it is about.");
      return;
    }
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
      setProjectId(""); setTitle(""); setDescription(""); setItemType("task"); setItemRef("");
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
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare aria-hidden="true" className="h-4 w-4 text-primary" /> Request approval
          </CardTitle>
          <CardDescription>The client’s decision comes back onto the board.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-4">
            <Field label="Project" htmlFor="apr-project"
              hint={projectId
                ? (linkedClients.length
                  ? `Visible to: ${linkedClients.map((c) => c.name || c.email).join(", ")}`
                  : "No clients linked to this project yet — link one under “Project links”.")
                : undefined}>
              <select id="apr-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={CONTROL}>
                <option value="">— Select project —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Title" htmlFor="apr-title" required>
              <Input id="apr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Homepage design v2" required />
            </Field>
            <Field label="Description" htmlFor="apr-description">
              <textarea id="apr-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="What needs sign-off…" className={CONTROL} />
            </Field>
            <Field label="Item type" htmlFor="apr-item-type">
              <select id="apr-item-type" value={itemType} onChange={(e) => setItemType(e.target.value)} className={`${CONTROL} capitalize`}>
                {APPROVAL_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            {itemType === "task" ? (
              <Field label="Task" htmlFor="apr-task"
                hint={projectId && !tasksLoading && taskOptions.length === 0
                  ? "This project has no client-visible tasks yet. Turn on \"Visible to client\" on a task first — a client cannot approve work they cannot open."
                  : "The client's decision is stamped back onto this task, so the team sees it on the board."}>
                <select id="apr-task" value={itemRef} onChange={(e) => setItemRef(e.target.value)}
                  disabled={!projectId || tasksLoading} className={`${CONTROL} disabled:opacity-50`}>
                  <option value="">{!projectId ? "Pick a project first" : tasksLoading ? "Loading tasks…" : "Select a task"}</option>
                  {taskOptions.map((t) => <option key={t.id} value={t.id}>{t.task_title}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Item reference (optional)" htmlFor="apr-item-ref">
                <Input id="apr-item-ref" value={itemRef} onChange={(e) => setItemRef(e.target.value)}
                  placeholder="UUID of referenced item" />
              </Field>
            )}
            <Button type="submit" disabled={saving} className="w-full">
              <Plus aria-hidden="true" className="h-4 w-4" /> {saving ? "Sending…" : "Request approval"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Section title="Approval requests">
          {loadError ? (
            <ErrorState title="Couldn't load approvals" description={loadError} onRetry={reload} />
          ) : loading ? (
            <SkeletonList rows={3} />
          ) : approvals.length === 0 ? (
            <EmptyState icon={CheckSquare} title="No approval requests yet"
              description="Ask a client to sign off on a task, deliverable or milestone." />
          ) : (
            <div className="space-y-3">
              {approvals.map((a) => (
                <Card key={a.id}>
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-foreground">{a.title}</p>
                          <StatusPill status={pillStatus(a.status)} label={a.status} size="sm" className="capitalize" />
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.description || "—"}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(a)}
                        title="Delete" aria-label={`Delete approval ${a.title}`}
                        className={`shrink-0 ${DANGER_ICON_BTN}`}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" size="sm">
                        <Building2 aria-hidden="true" /> {projName(a.project_id)}
                      </Badge>
                      <Badge variant="secondary" size="sm" className="capitalize">{a.item_type}</Badge>
                      <span>Requested {fmtDate(a.created_at)}</span>
                      {a.decided_at && <span>· Decided {fmtDate(a.decided_at)}</span>}
                      {a.note && <span className="italic">“{a.note}”</span>}
                    </div>
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

/* ---------------- Support ---------------- */
function ClientSupportTab({ orgId, admin, clients, threads, reload, loading, loadError }) {
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  // Presentation-only: surfaces the failure openThread already caught.
  const [msgError, setMsgError] = useState(null);
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
    setMsgError(null);
    try {
      const { data } = await supabase
        .from("support_messages")
        .select("*")
        .eq("thread_id", t.id)
        .order("created_at", { ascending: true });
      setMessages(data || []);
    } catch (err) {
      setMessages([]);
      setMsgError(err?.message || "Could not load this conversation.");
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
        <Section title="Support threads">
          {loadError ? (
            <ErrorState title="Couldn't load threads" description={loadError} onRetry={reload} />
          ) : loading ? (
            <SkeletonList rows={4} />
          ) : threads.length === 0 ? (
            <EmptyState icon={LifeBuoy} title="No support threads yet"
              description="Clients start conversations from their portal — they land here." />
          ) : (
            <div className="space-y-2">
              {threads.map((t) => {
                const active = t.id === activeId;
                return (
                  <button key={t.id} type="button" onClick={() => openThread(t)} aria-pressed={active}
                    className={`w-full rounded-xl border p-4 text-left shadow-card transition-colors duration-150 ${FOCUS_RING} ${
                      active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{t.subject}</p>
                      <StatusPill status={pillStatus(t.status)} label={t.status} size="sm" className="shrink-0 capitalize" />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{clientName(t.client_id)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(t.last_message_at)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      {/* Conversation */}
      <div className="lg:col-span-2">
        {!activeThread ? (
          <EmptyState icon={MessageSquare} title="Select a thread"
            description="Pick a conversation on the left to read it and reply as the agency." />
        ) : (
          <Card className="flex h-full flex-col animate-fade-in motion-reduce:animate-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border pb-4">
              <div className="min-w-0">
                <CardTitle className="truncate">{activeThread.subject}</CardTitle>
                <CardDescription className="truncate">{clientName(activeThread.client_id)}</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill status={pillStatus(activeThread.status)} label={activeThread.status} size="sm" className="capitalize" />
                <Button type="button" variant="outline" size="sm" onClick={() => toggleStatus(activeThread)}>
                  {activeThread.status === "open" ? "Close thread" : "Reopen"}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="max-h-[420px] min-h-[220px] flex-1 space-y-3 overflow-y-auto">
              {msgError ? (
                <ErrorState title="Couldn't load messages" description={msgError} onRetry={() => openThread(activeThread)} />
              ) : loadingMsgs ? (
                <SkeletonList rows={3} />
              ) : messages.length === 0 ? (
                <EmptyState icon={MessageSquare} title="No messages in this thread yet"
                  description="Send the first reply below." />
              ) : messages.map((m) => {
                const agency = m.sender_type === "agency";
                return (
                  <div key={m.id} className={`flex ${agency ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      agency ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}>
                      <p className="mb-0.5 flex items-center gap-1 text-xs opacity-80">
                        <MessageSquare aria-hidden="true" className="h-4 w-4" /> {m.sender_name || (agency ? "Agency" : "Client")}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-xs opacity-70">{fmtDateTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>

            <CardFooter>
              <form onSubmit={send} className="flex w-full items-end gap-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
                  aria-label="Reply as agency" placeholder="Reply as agency…"
                  className={`flex-1 resize-none ${CONTROL}`} />
                <Button type="submit" disabled={sending || !reply.trim()}>
                  <Send aria-hidden="true" className="h-4 w-4" /> {sending ? "…" : "Send"}
                </Button>
              </form>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
