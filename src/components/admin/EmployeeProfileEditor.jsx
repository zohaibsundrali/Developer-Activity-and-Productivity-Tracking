"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { X, Upload, Save, Loader2, User } from "lucide-react";
import { uploadEmployeePhoto, saveEmployee, reportingCycleError } from "@/utils/employeesData";
import { resolveOrgFileUrl } from "@/utils/orgFiles";
import { showSuccess, showError } from "@/utils/alerts";

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
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const DEFAULT_SCHEDULE = {
  start: "09:00",
  end: "17:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
};

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const labelClass = "mb-1 block text-xs font-medium text-foreground";
const headingClass = "text-sm font-semibold text-foreground";

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-elevated">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt={emp?.name || "Employee"} className="h-full w-full object-cover" />
              ) : (
                <User className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{emp?.name || "Employee"}</h2>
              <p className="text-sm text-muted-foreground">{emp?.email || ""}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Close"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Photo */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Photo</h3>
            <div className="mt-3 flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhoto}
                disabled={disabled || uploading}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading..." : "Upload photo"}
              </button>
              {form.photo_url ? (
                <span className="text-xs text-muted-foreground">Photo set</span>
              ) : (
                <span className="text-xs text-muted-foreground">No photo uploaded</span>
              )}
            </div>
            {uploadError ? <p className="mt-2 text-xs text-red-500">{uploadError}</p> : null}
          </section>

          {/* Identity (read-only) */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Identity</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Full name</label>
                <input className={inputClass} value={emp?.name || ""} readOnly disabled />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input className={inputClass} value={emp?.email || ""} readOnly disabled />
              </div>
              <div>
                <label className={labelClass}>Designation</label>
                <input
                  className={inputClass}
                  value={form.designation}
                  onChange={(e) => setField("designation", e.target.value)}
                  disabled={disabled}
                  placeholder="e.g. Senior Engineer"
                />
              </div>
              <div>
                <label className={labelClass}>Role</label>
                <select
                  className={inputClass}
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
              </div>
            </div>
          </section>

          {/* Org placement */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Organization</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Department</label>
                <select
                  className={inputClass}
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
              </div>
              <div>
                <label className={labelClass}>Team</label>
                <select
                  className={inputClass}
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
              </div>
              <div>
                <label className={labelClass}>Reports to</label>
                <select
                  className={inputClass}
                  value={form.reportsTo || ""}
                  onChange={(e) => setField("reportsTo", e.target.value)}
                  disabled={disabled}
                >
                  <option value="">No manager</option>
                  {reportOptions.map((e) => (
                    <option key={e.userId} value={e.userId}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Membership status</label>
                <select
                  className={inputClass}
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
              </div>
            </div>
          </section>

          {/* Employment */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Employment</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Employment status</label>
                <select
                  className={inputClass}
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
              </div>
              <div>
                <label className={labelClass}>Employment type</label>
                <select
                  className={inputClass}
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
              </div>
              <div>
                <label className={labelClass}>Joining date</label>
                <input
                  type="date"
                  className={inputClass}
                  value={form.joining_date || ""}
                  onChange={(e) => setField("joining_date", e.target.value)}
                  disabled={disabled}
                />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  disabled={disabled}
                  placeholder="e.g. +1 555 000 1234"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Address</label>
                <input
                  className={inputClass}
                  value={form.address}
                  onChange={(e) => setField("address", e.target.value)}
                  disabled={disabled}
                  placeholder="Street, city, country"
                />
              </div>
            </div>
          </section>

          {/* Work schedule */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Work schedule</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Start time</label>
                <input
                  type="time"
                  className={inputClass}
                  value={form.work_schedule.start}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      work_schedule: { ...prev.work_schedule, start: e.target.value },
                    }))
                  }
                  disabled={disabled}
                />
              </div>
              <div>
                <label className={labelClass}>End time</label>
                <input
                  type="time"
                  className={inputClass}
                  value={form.work_schedule.end}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      work_schedule: { ...prev.work_schedule, end: e.target.value },
                    }))
                  }
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className={labelClass}>Working days</label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const active = form.work_schedule.days.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => toggleDay(d.key)}
                      disabled={disabled}
                      className={
                        active
                          ? "rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          : "rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      }
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Skills */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Skills</h3>
            <div className="mt-3">
              {skills.length ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {s}
                      {!disabled ? (
                        <button
                          type="button"
                          onClick={() => removeSkill(s)}
                          aria-label={`Remove ${s}`}
                          className="rounded-full hover:text-primary/70"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-muted-foreground">No skills added yet.</p>
              )}
              {!disabled ? (
                <input
                  className={inputClass}
                  value={skillDraft}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  onKeyDown={onSkillKeyDown}
                  onBlur={() => addSkill(skillDraft)}
                  placeholder="Type a skill and press Enter or comma"
                />
              ) : null}
            </div>
          </section>

          {/* Bio */}
          <section className="rounded-xl border border-border p-4">
            <h3 className={headingClass}>Bio</h3>
            <textarea
              className={`${inputClass} mt-3 min-h-[96px] resize-y`}
              value={form.bio}
              onChange={(e) => setField("bio", e.target.value)}
              disabled={disabled}
              placeholder="Short description about the employee"
            />
          </section>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => onClose?.()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            {canManage ? "Cancel" : "Close"}
          </button>
          {canManage ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : "Save changes"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
