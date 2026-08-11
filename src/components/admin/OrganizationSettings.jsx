"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { uploadOrgFile, resolveOrgFileUrl } from "@/utils/orgFiles";
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

/** Refusal shown when a save is attempted on a form that never held real data. */
export const NOT_LOADED_MESSAGE =
  "These settings never finished loading, so saving now would overwrite your organization with blank defaults. Reload and try again.";

/**
 * supabase-js RESOLVES with `{ data, error }` — it does not reject — so a
 * try/catch around a query never fires, and code that reads only `.data`
 * cannot tell an RLS denial, a 4xx or a 5xx apart from "no rows". Read the
 * error that is already being returned and throw it, so the catch (and the
 * ErrorState it feeds) becomes reachable.
 */
function unwrap(result, fallback) {
  if (result?.error) throw new Error(result.error.message || fallback);
  return result?.data ?? null;
}

/**
 * Merge one stored settings section over its defaults, ignoring stored nulls.
 * A plain spread let a stored `{"days": null}` beat the default, and
 * `settings.working_hours.days.includes(...)` then threw a TypeError during
 * render and took the whole tab down.
 */
function mergeSection(defaults, stored) {
  const out = { ...defaults };
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored)) {
      if (v !== null && v !== undefined) out[k] = v;
    }
  }
  return out;
}

/** Normalize the `settings` jsonb into a shape every control can render. */
export function mergeOrgSettings(stored) {
  const workingHours = mergeSection(DEFAULTS.working_hours, stored?.working_hours);
  return {
    working_hours: {
      ...workingHours,
      // `days` is dereferenced with .includes()/.filter() on every render.
      days: Array.isArray(workingHours.days) ? workingHours.days : DEFAULTS.working_hours.days,
    },
    notifications: mergeSection(DEFAULTS.notifications, stored?.notifications),
    security: mergeSection(DEFAULTS.security, stored?.security),
  };
}

/**
 * Read the organization row.
 * Throws on failure; returns null only when the read succeeded and no row is
 * visible. Failed and empty are different answers and must not be conflated.
 */
export async function fetchOrganization(orgId) {
  const res = await supabase.from("organizations").select("*").eq("id", orgId).maybeSingle();
  return unwrap(res, "Could not load your organization settings.");
}

/**
 * Write the form back to the organization row.
 *
 * `hydrated` is the guard on the destructive path: the form starts on
 * DEFAULTS, and every one of `logo_url` / `industry` / `company_size` /
 * `country` evaluates `"" || null` -> null while `timezone` forces "UTC", so
 * one save from a never-loaded form blanks five columns plus the `settings`
 * jsonb. A form that has never held real data must not be able to overwrite
 * real data, so the write is refused before it is issued.
 */
export async function saveOrganization({ orgId, hydrated, form, settings, org }) {
  if (!orgId || !hydrated) throw new Error(NOT_LOADED_MESSAGE);
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
  if (error) throw new Error(error.message || "Could not save settings.");
}

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
  // `form.logo_url` holds a storage PATH; this holds the short-lived signed URL
  // it resolves to. Kept apart so the expiring URL is never what gets saved.
  // `resolveOrgFileUrl` passes a legacy `http…` value straight through, so
  // organizations whose logo predates this still render.
  const [logoSrc, setLogoSrc] = useState(null);
  const [settings, setSettings] = useState(DEFAULTS);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    // Drop any previously loaded record first: `org` is what marks the form as
    // holding real data, and a failed reload must not leave that mark behind.
    setOrg(null);
    try {
      const data = await fetchOrganization(orgId);
      if (data) {
        setOrg(data);
        setForm({
          name: data.name || "", logo_url: data.logo_url || "", industry: data.industry || "",
          company_size: data.company_size || "", country: data.country || "", timezone: data.timezone || "UTC",
        });
        setSettings(mergeOrgSettings(data.settings));
        setLogoSrc(data.logo_url ? await resolveOrgFileUrl(data.logo_url) : null);
      }
    } catch (err) {
      setLoadError(err?.message || "Could not load your organization settings.");
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setWH = (k, v) => setSettings((s) => ({ ...s, working_hours: { ...s.working_hours, [k]: v } }));
  const toggleDay = (d) => setSettings((s) => {
    const current = Array.isArray(s.working_hours.days) ? s.working_hours.days : DEFAULTS.working_hours.days;
    const days = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
    return { ...s, working_hours: { ...s.working_hours, days } };
  });
  const setNotif = (k, v) => setSettings((s) => ({ ...s, notifications: { ...s.notifications, [k]: v } }));
  const setSec = (k, v) => setSettings((s) => ({ ...s, security: { ...s.security, [k]: v } }));

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploading(true);
    try {
      // Into the PRIVATE `org-files` bucket, storing the PATH — not a URL.
      //
      // This used to write to `documents` and save `getPublicUrl(path)`.
      // `getPublicUrl` does not ask the server anything; it just builds a
      // /object/public/ URL. Once `documents` was made private that URL
      // started returning 400, so the saved value was a dead link and the
      // logo silently stopped rendering — the upload still "succeeded", which
      // is why nothing looked broken.
      //
      // org-files already carries per-organization storage policies keyed on
      // the leading path segment, so this also stops one tenant's logo from
      // sitting in a bucket root beside everyone else's.
      const path = await uploadOrgFile({ orgId, category: "branding", file });
      setField("logo_url", path);
      setLogoSrc(await resolveOrgFileUrl(path));
      showSuccess("Logo uploaded", "Remember to Save changes.");
    } catch (err) {
      showError("Upload failed", err.message || "Could not upload the logo.");
    } finally { setUploading(false); }
  };

  // Only a successful read of a real row marks the form as safe to save from.
  const hydrated = Boolean(org);

  const save = async () => {
    if (readOnly) return;
    if (!hydrated) { showError("Nothing to save", NOT_LOADED_MESSAGE); return; }
    setSaving(true);
    try {
      await saveOrganization({ orgId, hydrated, form, settings, org });
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
  // Read succeeded, no row came back: genuinely empty, not failed. The form
  // stays off the screen either way, because saving it would write defaults
  // over whatever the row actually holds.
  if (!hydrated) return (
    <EmptyState
      icon={Building2}
      title="Organization not found"
      description="This workspace no longer exists, or your account can't see it. Sign in again, or ask an owner for access."
    />
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
                {logoSrc
                  ? <img src={logoSrc} alt="Organization logo" className="h-full w-full object-cover" />
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
          <Button type="button" onClick={save} disabled={saving || !hydrated}>
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
