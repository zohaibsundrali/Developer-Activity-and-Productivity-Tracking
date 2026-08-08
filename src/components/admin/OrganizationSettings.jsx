"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { showSuccess, showError } from "@/utils/alerts";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  EmptyState, ErrorState, Skeleton, Field, Button, Input,
} from "@/components/ui";
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

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const CONTROL = `w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 ${FOCUS_RING}`;

/** A skeleton shaped like the settings form, not a spinner on a blank page. */
function SettingsFormSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading organization settings">
      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 flex flex-col gap-6 md:flex-row">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-24 w-24 rounded-2xl" />
            <Skeleton className="h-7 w-28" />
          </div>
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <Skeleton className="h-4 w-36" />
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-64" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <Skeleton className="h-4 w-48" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <Skeleton className="h-4 w-24" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function OrganizationSettings({ readOnly = false }) {
  // Resolve org id after mount to avoid a hydration mismatch.
  const [orgId, setOrgId] = useState(null);
  const [orgReady, setOrgReady] = useState(false);
  useEffect(() => { setOrgId(getOrgId()); setOrgReady(true); }, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Presentation-only: surfaces the failure `load` already caught so the screen
  // can offer a retry instead of silently showing the empty default form.
  const [loadError, setLoadError] = useState(null);
  const [org, setOrg] = useState(null);
  const [form, setForm] = useState({
    name: "", logo_url: "", industry: "", company_size: "", country: "", timezone: "UTC",
  });
  const [settings, setSettings] = useState(DEFAULTS);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
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
    } catch (err) {
      setLoadError(err?.message || "Could not load your organization settings.");
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

  if (!orgReady || loading) return <SettingsFormSkeleton />;
  if (!orgId) return (
    <EmptyState
      icon={Building2}
      title="No organization context"
      description="We couldn't tell which workspace these settings belong to. Please sign in again."
    />
  );
  if (loadError) return (
    <ErrorState title="Couldn't load organization settings" description={loadError} onRetry={load} />
  );

  return (
    <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">
      {readOnly && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground sm:p-5">
          <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-semibold">View-only.</span> Only the organization
            Owner can change these settings.
          </p>
        </div>
      )}

      {/* Company profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 aria-hidden="true" className="h-4 w-4 text-primary" /> Company Profile
          </CardTitle>
          <CardDescription>How this workspace is identified across the product.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
                {form.logo_url
                  ? <img src={form.logo_url} alt="Organization logo" className="h-full w-full object-cover" />
                  : <Building2 aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
              </div>
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background`}>
                {uploading
                  ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  : <Upload aria-hidden="true" className="h-4 w-4" />}
                {uploading ? "Uploading…" : "Upload logo"}
                <input type="file" accept="image/*" className="sr-only" onChange={uploadLogo} disabled={uploading} />
              </label>
            </div>
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              <Field label="Organization name" htmlFor="org-name">
                <Input id="org-name" value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </Field>
              <Field label="Industry" htmlFor="org-industry">
                <select id="org-industry" value={form.industry} onChange={(e) => setField("industry", e.target.value)} className={CONTROL}>
                  <option value="">— Select —</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field label="Company size" htmlFor="org-size">
                <select id="org-size" value={form.company_size} onChange={(e) => setField("company_size", e.target.value)} className={CONTROL}>
                  <option value="">— Select —</option>
                  {SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </Field>
              <Field label="Country" htmlFor="org-country">
                <Input id="org-country" value={form.country} onChange={(e) => setField("country", e.target.value)} placeholder="Pakistan" />
              </Field>
              <Field label="Timezone" htmlFor="org-timezone">
                <select id="org-timezone" value={form.timezone} onChange={(e) => setField("timezone", e.target.value)} className={CONTROL}>
                  {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Working hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock aria-hidden="true" className="h-4 w-4 text-primary" /> Working Hours
          </CardTitle>
          <CardDescription>Used for attendance windows and deadline reminders.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Start" htmlFor="wh-start">
              <Input id="wh-start" type="time" value={settings.working_hours.start} onChange={(e) => setWH("start", e.target.value)} />
            </Field>
            <Field label="End" htmlFor="wh-end">
              <Input id="wh-end" type="time" value={settings.working_hours.end} onChange={(e) => setWH("end", e.target.value)} />
            </Field>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground" id="working-days-label">Working days</p>
              <div role="group" aria-labelledby="working-days-label" className="flex flex-wrap gap-1.5">
                {DAYS.map(([d, label]) => {
                  const on = settings.working_hours.days.includes(d);
                  return (
                    <Button key={d} type="button" size="xs" variant={on ? "default" : "outline"}
                      onClick={() => toggleDay(d)} aria-pressed={on}>
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell aria-hidden="true" className="h-4 w-4 text-primary" /> Notification Preferences
          </CardTitle>
          <CardDescription>What this organization emails out by default.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle label="Email notifications" checked={settings.notifications.email} onChange={(v) => setNotif("email", v)} />
            <Toggle label="Task submission alerts" checked={settings.notifications.task_alerts} onChange={(v) => setNotif("task_alerts", v)} />
            <Toggle label="Deadline reminders" checked={settings.notifications.deadline_reminders} onChange={(v) => setNotif("deadline_reminders", v)} />
            <Toggle label="Weekly reports" checked={settings.notifications.weekly_reports} onChange={(v) => setNotif("weekly_reports", v)} />
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield aria-hidden="true" className="h-4 w-4 text-primary" /> Security
          </CardTitle>
          <CardDescription>Session length and password rules for this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Session timeout (days)" htmlFor="sec-session-days" hint="Between 1 and 90 days.">
              <Input id="sec-session-days" type="number" min={1} max={90} value={settings.security.session_days}
                onChange={(e) => setSec("session_days", Number(e.target.value) || 7)} />
            </Field>
            <div className="flex items-end">
              <Toggle label="Require strong passwords" checked={settings.security.require_strong_password} onChange={(v) => setSec("require_strong_password", v)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={saving}>
            {saving
              ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              : <Save aria-hidden="true" className="h-4 w-4" />}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} role="switch" aria-checked={checked}
      className={`flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted ${FOCUS_RING}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-card transition-all duration-150 motion-reduce:transition-none ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
