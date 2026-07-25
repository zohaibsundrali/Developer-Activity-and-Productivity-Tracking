"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { showSuccess, showError } from "@/utils/alerts";
import { Building2, Clock, Bell, Shield, Upload, Save, Loader2, Lock } from "lucide-react";

const INDUSTRIES = ["Technology", "Finance", "Healthcare", "Education", "Retail", "Manufacturing", "Consulting", "Marketing", "Other"];
const SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];
const TIMEZONES = ["UTC", "Asia/Karachi", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];

const DEFAULTS = {
  working_hours: { start: "09:00", end: "17:00", days: ["mon", "tue", "wed", "thu", "fri"] },
  notifications: { email: true, task_alerts: true, deadline_reminders: true, weekly_reports: false },
  security: { session_days: 7, require_strong_password: false },
};

export default function OrganizationSettings({ readOnly = false }) {
  // Resolve org id after mount to avoid a hydration mismatch.
  const [orgId, setOrgId] = useState(null);
  const [orgReady, setOrgReady] = useState(false);
  useEffect(() => { setOrgId(getOrgId()); setOrgReady(true); }, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [org, setOrg] = useState(null);
  const [form, setForm] = useState({
    name: "", logo_url: "", industry: "", company_size: "", country: "", timezone: "UTC",
  });
  const [settings, setSettings] = useState(DEFAULTS);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await supabase.from("organizations").select("*").eq("id", orgId).maybeSingle();
      if (data) {
        setOrg(data);
        setForm({
          name: data.name || "", logo_url: data.logo_url || "", industry: data.industry || "",
          company_size: data.company_size || "", country: data.country || "", timezone: data.timezone || "UTC",
        });
        setSettings({
          working_hours: { ...DEFAULTS.working_hours, ...(data.settings?.working_hours || {}) },
          notifications: { ...DEFAULTS.notifications, ...(data.settings?.notifications || {}) },
          security: { ...DEFAULTS.security, ...(data.settings?.security || {}) },
        });
      }
    } catch {
      /* ignore */
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setWH = (k, v) => setSettings((s) => ({ ...s, working_hours: { ...s.working_hours, [k]: v } }));
  const toggleDay = (d) => setSettings((s) => {
    const days = s.working_hours.days.includes(d) ? s.working_hours.days.filter((x) => x !== d) : [...s.working_hours.days, d];
    return { ...s, working_hours: { ...s.working_hours, days } };
  });
  const setNotif = (k, v) => setSettings((s) => ({ ...s, notifications: { ...s.notifications, [k]: v } }));
  const setSec = (k, v) => setSettings((s) => ({ ...s, security: { ...s.security, [k]: v } }));

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploading(true);
    try {
      const path = `org-logos/${orgId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (error) throw error;
      const { data } = supabase.storage.from("documents").getPublicUrl(path);
      setField("logo_url", data?.publicUrl || "");
      showSuccess("Logo uploaded", "Remember to Save changes.");
    } catch (err) {
      showError("Upload failed", err.message || "Could not upload the logo.");
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!orgId || readOnly) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("organizations").update({
        name: form.name.trim() || org?.name,
        logo_url: form.logo_url || null,
        industry: form.industry || null,
        company_size: form.company_size || null,
        country: form.country.trim() || null,
        timezone: form.timezone || "UTC",
        settings,
        updated_at: new Date().toISOString(),
      }).eq("id", orgId);
      if (error) throw error;
      showSuccess("Settings saved", "Your organization settings have been updated.");
    } catch (err) {
      showError("Save failed", err.message || "Could not save settings.");
    } finally { setSaving(false); }
  };

  if (!orgReady || loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!orgId) return <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">No organization context.</div>;

  const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

  return (
    <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-5 border-0 p-0">
      {readOnly && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-semibold">View-only.</span> Only the organization
            Owner can change these settings.
          </p>
        </div>
      )}
      {/* Company profile */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Building2 className="h-4 w-4 text-primary" /> Company Profile</h3>
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
              {form.logo_url
                ? <img src={form.logo_url} alt="Logo" className="h-full w-full object-cover" />
                : <Building2 className="h-8 w-8 text-muted-foreground" />}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload logo"}
              <input type="file" accept="image/*" className="hidden" onChange={uploadLogo} disabled={uploading} />
            </label>
          </div>
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <Field label="Organization name"><input value={form.name} onChange={(e) => setField("name", e.target.value)} className={inputCls} /></Field>
            <Field label="Industry">
              <select value={form.industry} onChange={(e) => setField("industry", e.target.value)} className={inputCls}>
                <option value="">— Select —</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Company size">
              <select value={form.company_size} onChange={(e) => setField("company_size", e.target.value)} className={inputCls}>
                <option value="">— Select —</option>
                {SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
              </select>
            </Field>
            <Field label="Country"><input value={form.country} onChange={(e) => setField("country", e.target.value)} placeholder="Pakistan" className={inputCls} /></Field>
            <Field label="Timezone">
              <select value={form.timezone} onChange={(e) => setField("timezone", e.target.value)} className={inputCls}>
                {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </section>

      {/* Working hours */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Clock className="h-4 w-4 text-primary" /> Working Hours</h3>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Start"><input type="time" value={settings.working_hours.start} onChange={(e) => setWH("start", e.target.value)} className={inputCls} /></Field>
          <Field label="End"><input type="time" value={settings.working_hours.end} onChange={(e) => setWH("end", e.target.value)} className={inputCls} /></Field>
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Working days</p>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([d, label]) => {
                const on = settings.working_hours.days.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:bg-muted"}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Bell className="h-4 w-4 text-primary" /> Notification Preferences</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle label="Email notifications" checked={settings.notifications.email} onChange={(v) => setNotif("email", v)} />
          <Toggle label="Task submission alerts" checked={settings.notifications.task_alerts} onChange={(v) => setNotif("task_alerts", v)} />
          <Toggle label="Deadline reminders" checked={settings.notifications.deadline_reminders} onChange={(v) => setNotif("deadline_reminders", v)} />
          <Toggle label="Weekly reports" checked={settings.notifications.weekly_reports} onChange={(v) => setNotif("weekly_reports", v)} />
        </div>
      </section>

      {/* Security */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Shield className="h-4 w-4 text-primary" /> Security</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Session timeout (days)">
            <input type="number" min={1} max={90} value={settings.security.session_days}
              onChange={(e) => setSec("session_days", Number(e.target.value) || 7)} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Toggle label="Require strong passwords" checked={settings.security.require_strong_password} onChange={(v) => setSec("require_strong_password", v)} />
          </div>
        </div>
      </section>

      {!readOnly && (
        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </fieldset>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
