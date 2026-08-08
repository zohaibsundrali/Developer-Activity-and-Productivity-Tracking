"use client";

import { useState, useRef, useMemo, useEffect, useId } from "react";
import { Upload, Save, Loader2, User, X, RotateCcw } from "lucide-react";
import { uploadEmployeePhoto, saveEmployee, reportingCycleError } from "@/utils/employeesData";
import { resolveOrgFileUrl } from "@/utils/orgFiles";
import { showSuccess, showError } from "@/utils/alerts";
import {
  Modal,
  Section,
  Field,
  Input,
  Button,
  Badge,
  Skeleton,
} from "@/components/ui";

// Human-friendly label: "team_lead" -> "Team Lead".
const pretty = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");

const ROLE_OPTIONS = ["admin", "manager", "team_lead", "hr", "developer", "employee"];
const EMPLOYMENT_STATUS_OPTIONS = ["active", "on_leave", "suspended", "terminated"];
const EMPLOYMENT_TYPE_OPTIONS = ["full_time", "part_time", "contract", "intern"];
const MEMBERSHIP_STATUS_OPTIONS = ["active", "inactive", "suspended"];
const DAYS = [
  { key: "mon", label: "Mon", full: "Monday" },
  { key: "tue", label: "Tue", full: "Tuesday" },
  { key: "wed", label: "Wed", full: "Wednesday" },
  { key: "thu", label: "Thu", full: "Thursday" },
  { key: "fri", label: "Fri", full: "Friday" },
  { key: "sat", label: "Sat", full: "Saturday" },
  { key: "sun", label: "Sun", full: "Sunday" },
];

const DEFAULT_SCHEDULE = {
  start: "09:00",
  end: "17:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
};

// The kit has no Select/Textarea primitive, so these mirror Input's token
// styling rather than inventing a look of their own.
const controlClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";
const textareaClass =
  "min-h-[96px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

export default function EmployeeProfileEditor({
  emp,
  employees = [],
  teams = [],
  departments = [],
  orgId,
  canManage = true,
  onClose,
  onSaved,
}) {
  const profile = emp?.profile || {};
  const fileInputRef = useRef(null);
  const uid = useId();
  const fid = (name) => `${uid}-${name}`;

  // Local form state, initialized defensively from emp + emp.profile.
  const [form, setForm] = useState(() => ({
    role: emp?.role || "employee",
    status: emp?.status || "active",
    departmentId: emp?.departmentId || "",
    teamId: emp?.teamId || "",
    reportsTo: emp?.reportsTo || "",
    designation: profile.designation || "",
    phone: profile.phone || "",
    address: profile.address || "",
    employment_status: profile.employment_status || "active",
    employment_type: profile.employment_type || "full_time",
    joining_date: profile.joining_date || "",
    photo_url: profile.photo_url || "",
    bio: profile.bio || "",
    work_schedule:
      profile.work_schedule && typeof profile.work_schedule === "object"
        ? {
            start: profile.work_schedule.start || DEFAULT_SCHEDULE.start,
            end: profile.work_schedule.end || DEFAULT_SCHEDULE.end,
            days: Array.isArray(profile.work_schedule.days)
              ? profile.work_schedule.days
              : [...DEFAULT_SCHEDULE.days],
          }
        : { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] },
  }));

  const [skills, setSkills] = useState(() =>
    Array.isArray(profile.skills) ? profile.skills.filter(Boolean) : []
  );
  const [skillDraft, setSkillDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const disabled = !canManage;

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // Teams filtered to the selected department (or all when none picked).
  const visibleTeams = useMemo(() => {
    if (!form.departmentId) return teams;
    return teams.filter(
      (t) => String(t.department_id) === String(form.departmentId) || !t.department_id
    );
  }, [teams, form.departmentId]);

  // "Reports to" options: everyone except the current employee.
  const reportOptions = useMemo(
    () => (employees || []).filter((e) => e.userId !== emp?.userId),
    [employees, emp?.userId]
  );

  // Dropping this employee under someone who already reports to them (directly
  // or through anyone in between) closes a reporting loop, and a loop makes
  // every walk up the chain — org chart, approval ladder, "notify my manager" —
  // run forever. Migration 037 refuses the write at the database, which is what
  // actually protects the data; this recomputes the same answer from the
  // directory already in memory so the person sees why before they save,
  // named, rather than a check-constraint violation afterwards.
  const hierarchyError = useMemo(
    () =>
      reportingCycleError({
        employees,
        userId: emp?.userId,
        reportsTo: form.reportsTo || null,
      }),
    [employees, emp?.userId, form.reportsTo]
  );

  const toggleDay = (day) => {
    if (disabled) return;
    setForm((prev) => {
      const has = prev.work_schedule.days.includes(day);
      const days = has
        ? prev.work_schedule.days.filter((d) => d !== day)
        : [...prev.work_schedule.days, day];
      return { ...prev, work_schedule: { ...prev.work_schedule, days } };
    });
  };

  const addSkill = (raw) => {
    const value = String(raw || "").trim();
    if (!value) return;
    setSkills((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setSkillDraft("");
  };

  const removeSkill = (value) => {
    if (disabled) return;
    setSkills((prev) => prev.filter((s) => s !== value));
  };

  const onSkillKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill(skillDraft);
    }
  };

  const handleDepartmentChange = (value) => {
    setForm((prev) => {
      // Clear team if it no longer belongs to the selected department.
      const stillValid = teams.some(
        (t) =>
          String(t.id) === String(prev.teamId) &&
          (String(t.department_id) === String(value) || !t.department_id)
      );
      return { ...prev, departmentId: value, teamId: stillValid ? prev.teamId : "" };
    });
  };

  // photo_url now holds a private storage path, so it cannot be rendered
  // directly. Sign it for display; legacy rows holding a full URL pass through
  // unchanged inside resolveOrgFileUrl.
  const [photoPreview, setPhotoPreview] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!form.photo_url) {
      setPhotoPreview(null);
      return undefined;
    }
    resolveOrgFileUrl(form.photo_url).then((url) => {
      if (!cancelled) setPhotoPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [form.photo_url]);

  const handlePhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const url = await uploadEmployeePhoto(orgId, emp?.userId, file);
      setField("photo_url", url);
    } catch (err) {
      setUploadError(err?.message || "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!canManage || saving) return;
    if (hierarchyError) {
      showError("Invalid reporting line", hierarchyError);
      return;
    }
    setSaving(true);
    try {
      const membershipPatch = {
        role: form.role,
        team_id: form.teamId || null,
        department_id: form.departmentId || null,
        reports_to: form.reportsTo || null,
        status: form.status,
      };
      const profilePatch = {
        designation: form.designation || null,
        phone: form.phone || null,
        address: form.address || null,
        skills,
        employment_status: form.employment_status,
        employment_type: form.employment_type,
        joining_date: form.joining_date || null,
        work_schedule: form.work_schedule,
        photo_url: form.photo_url || null,
        bio: form.bio || null,
      };

      const { error } = await saveEmployee({ orgId, emp, membershipPatch, profilePatch, employees });
      if (error) {
        // 23514 is the check violation migration 037 raises. Its message is
        // already written for a human, so pass it through rather than burying
        // it in "Could not save employee: ...".
        if (error.code === "reporting_cycle" || error.code === "23514") {
          showError("Invalid reporting line", error.message || String(error));
          return;
        }
        showError("Save failed", `Could not save employee: ${error.message || error}`);
        return;
      }
      showSuccess("Saved", `${emp?.name || "Employee"} updated successfully.`);
      onSaved?.();
      onClose?.();
    } catch (err) {
      showError("Save failed", `Could not save employee: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // Photo has four visible states: uploading, failed, a resolved preview, and
  // "a path we are still signing" — the last one used to render nothing at all.
  const photoResolving = Boolean(form.photo_url) && !photoPreview && !uploading;

  const scheduleSummary = (() => {
    const picked = DAYS.filter((d) => form.work_schedule.days.includes(d.key));
    if (!picked.length) return "No working days selected";
    return `${picked.map((d) => d.label).join(", ")} · ${form.work_schedule.start}–${form.work_schedule.end}`;
  })();

  return (
    <Modal
      open
      onClose={() => onClose?.()}
      title={emp?.name || "Employee"}
      description={emp?.email || "Employee profile"}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose?.()}>
            {canManage ? "Cancel" : "Close"}
          </Button>
          {canManage ? (
            <Button onClick={handleSave} disabled={saving} aria-busy={saving || undefined}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-6">
        {!canManage && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            You have read-only access to this profile.
          </p>
        )}

        {/* ── Identity ─────────────────────────────────────────────────────── */}
        <Section
          title="Identity"
          description="Who this person is in the directory."
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* Photo */}
            <div className="flex items-center gap-4 sm:flex-col sm:items-start">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                {uploading ? (
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    <Loader2
                      className="h-5 w-5 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                ) : photoResolving ? (
                  <Skeleton className="h-full w-full rounded-full" />
                ) : photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt={`${emp?.name || "Employee"} profile photo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <User
                      className="h-7 w-7 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  id={fid("photo")}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handlePhoto}
                  disabled={disabled || uploading}
                />
                <Button
                  type="button"
                  variant={uploadError ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || uploading}
                  aria-busy={uploading || undefined}
                  aria-describedby={
                    uploadError ? fid("photo-error") : fid("photo-hint")
                  }
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : uploadError ? (
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  )}
                  {uploading
                    ? "Uploading…"
                    : uploadError
                    ? "Try again"
                    : form.photo_url
                    ? "Replace photo"
                    : "Upload photo"}
                </Button>
                {uploadError ? (
                  <p
                    id={fid("photo-error")}
                    role="alert"
                    className="max-w-[16rem] text-xs font-medium text-destructive"
                  >
                    {uploadError}
                  </p>
                ) : (
                  <p
                    id={fid("photo-hint")}
                    className="max-w-[16rem] text-xs text-muted-foreground"
                  >
                    {uploading
                      ? "Uploading — this can take a moment."
                      : form.photo_url
                      ? "Photo set. Saving the profile keeps it."
                      : "Square JPG or PNG works best."}
                  </p>
                )}
              </div>
            </div>

            {/* Name / email / designation */}
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                htmlFor={fid("name")}
                hint="Set by the person in their own account."
              >
                <Input id={fid("name")} value={emp?.name || ""} readOnly disabled />
              </Field>
              <Field
                label="Email"
                htmlFor={fid("email")}
                hint="Used to sign in — cannot be edited here."
              >
                <Input id={fid("email")} value={emp?.email || ""} readOnly disabled />
              </Field>
              <Field
                label="Designation"
                htmlFor={fid("designation")}
                hint="The job title shown in the directory."
              >
                <Input
                  id={fid("designation")}
                  value={form.designation}
                  onChange={(e) => setField("designation", e.target.value)}
                  disabled={disabled}
                  placeholder="e.g. Senior Engineer"
                />
              </Field>
              <Field label="Phone" htmlFor={fid("phone")}>
                <Input
                  id={fid("phone")}
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  disabled={disabled}
                  placeholder="e.g. +1 555 000 1234"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address" htmlFor={fid("address")}>
                  <Input
                    id={fid("address")}
                    value={form.address}
                    onChange={(e) => setField("address", e.target.value)}
                    disabled={disabled}
                    placeholder="Street, city, country"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Bio"
                  htmlFor={fid("bio")}
                  hint="A couple of sentences teammates see on the profile."
                >
                  <textarea
                    id={fid("bio")}
                    className={textareaClass}
                    value={form.bio}
                    onChange={(e) => setField("bio", e.target.value)}
                    disabled={disabled}
                    placeholder="Short description about the employee"
                  />
                </Field>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Employment ───────────────────────────────────────────────────── */}
        <Section
          title="Employment"
          description="Contract terms and workspace access."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Role"
              htmlFor={fid("role")}
              hint="Decides what this person can do in the workspace."
            >
              <select
                id={fid("role")}
                className={controlClass}
                value={form.role}
                onChange={(e) => setField("role", e.target.value)}
                disabled={disabled}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {pretty(r)}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Membership status"
              htmlFor={fid("status")}
              hint="Whether the account can sign in to this organization."
            >
              <select
                id={fid("status")}
                className={controlClass}
                value={form.status}
                onChange={(e) => setField("status", e.target.value)}
                disabled={disabled}
              >
                {MEMBERSHIP_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {pretty(s)}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Employment status"
              htmlFor={fid("employment_status")}
              hint="The HR record — separate from workspace access."
            >
              <select
                id={fid("employment_status")}
                className={controlClass}
                value={form.employment_status}
                onChange={(e) => setField("employment_status", e.target.value)}
                disabled={disabled}
              >
                {EMPLOYMENT_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {pretty(s)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Employment type" htmlFor={fid("employment_type")}>
              <select
                id={fid("employment_type")}
                className={controlClass}
                value={form.employment_type}
                onChange={(e) => setField("employment_type", e.target.value)}
                disabled={disabled}
              >
                {EMPLOYMENT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {pretty(t)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Joining date" htmlFor={fid("joining_date")}>
              <input
                id={fid("joining_date")}
                type="date"
                className={controlClass}
                value={form.joining_date || ""}
                onChange={(e) => setField("joining_date", e.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
        </Section>

        {/* ── Reporting line ───────────────────────────────────────────────── */}
        <Section
          title="Reporting line"
          description="Where this person sits in the org chart."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor={fid("department")}>
              <select
                id={fid("department")}
                className={controlClass}
                value={form.departmentId || ""}
                onChange={(e) => handleDepartmentChange(e.target.value)}
                disabled={disabled}
              >
                <option value="">Unassigned</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Team"
              htmlFor={fid("team")}
              hint={
                form.departmentId
                  ? "Limited to teams in the selected department."
                  : undefined
              }
            >
              <select
                id={fid("team")}
                className={controlClass}
                value={form.teamId || ""}
                onChange={(e) => setField("teamId", e.target.value)}
                disabled={disabled}
              >
                <option value="">Unassigned</option>
                {visibleTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>

            {/* The reporting-cycle message is the one error in this form that a
                person can actually trigger by thinking too fast, so it belongs
                next to the control that caused it — not in a dialog after the
                fact. Wording and detection are unchanged; only the presentation
                is. */}
            <div className="sm:col-span-2">
              <Field
                label="Reports to"
                htmlFor={fid("reportsTo")}
                error={hierarchyError || undefined}
                hint={
                  hierarchyError
                    ? undefined
                    : "The manager this person's chain rolls up to."
                }
              >
                <select
                  id={fid("reportsTo")}
                  className={controlClass}
                  value={form.reportsTo || ""}
                  onChange={(e) => setField("reportsTo", e.target.value)}
                  disabled={disabled}
                  aria-invalid={hierarchyError ? true : undefined}
                >
                  <option value="">No manager</option>
                  {reportOptions.map((e) => (
                    <option key={e.userId} value={e.userId}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Section>

        {/* ── Schedule ─────────────────────────────────────────────────────── */}
        <Section
          title="Schedule"
          description="Working hours and days used for attendance."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start time" htmlFor={fid("start")}>
              <input
                id={fid("start")}
                type="time"
                className={controlClass}
                value={form.work_schedule.start}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    work_schedule: { ...prev.work_schedule, start: e.target.value },
                  }))
                }
                disabled={disabled}
              />
            </Field>
            <Field label="End time" htmlFor={fid("end")}>
              <input
                id={fid("end")}
                type="time"
                className={controlClass}
                value={form.work_schedule.end}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    work_schedule: { ...prev.work_schedule, end: e.target.value },
                  }))
                }
                disabled={disabled}
              />
            </Field>
          </div>

          <fieldset className="mt-4 min-w-0">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Working days
            </legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const active = form.work_schedule.days.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    disabled={disabled}
                    aria-pressed={active}
                    aria-label={d.full}
                    className={`min-w-[3.25rem] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{scheduleSummary}</p>
          </fieldset>
        </Section>

        {/* ── Skills ───────────────────────────────────────────────────────── */}
        <Section
          title="Skills"
          description="Used to staff projects and search the directory."
        >
          {skills.length ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {skills.map((s) => (
                <Badge key={s} variant="secondary" size="md">
                  <span className="truncate">{s}</span>
                  {!disabled ? (
                    <button
                      type="button"
                      onClick={() => removeSkill(s)}
                      aria-label={`Remove ${s}`}
                      className="-mr-1 ml-1 rounded-full p-0.5 transition-colors duration-150 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mb-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No skills added yet.
            </p>
          )}
          {!disabled ? (
            <Field
              label="Add a skill"
              htmlFor={fid("skill")}
              hint="Press Enter or comma to add."
            >
              <Input
                id={fid("skill")}
                value={skillDraft}
                onChange={(e) => setSkillDraft(e.target.value)}
                onKeyDown={onSkillKeyDown}
                onBlur={() => addSkill(skillDraft)}
                placeholder="e.g. TypeScript"
              />
            </Field>
          ) : null}
        </Section>
      </div>
    </Modal>
  );
}
