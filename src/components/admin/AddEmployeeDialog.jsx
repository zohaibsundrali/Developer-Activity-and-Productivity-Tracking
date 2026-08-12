"use client";

import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";

import { Modal, Field, Input, Button } from "@/components/ui";
import { getOrgId } from "@/utils/orgContext";
import { getRole } from "@/utils/permissions";
import { grantableStaffRoles } from "@/utils/roles";
import { createStaffMember, MIN_PASSWORD_LENGTH } from "@/utils/staffAccounts";
import { validatePersonName } from "@/utils/nameValidation";
import { showError, showSuccess, showWarning } from "@/utils/alerts";

/**
 * Add somebody to the organization — name, email, password, role.
 *
 * This is the old "Add Developer" sidebar screen, moved. It sits inside
 * Employees now because that is where you go to find out who works here, and
 * "add one" is the same errand as "look at the list". Keeping it as its own
 * screen also meant a form that could only ever make developers, while the
 * organization has had designers, QA, HR and finance since migration 058.
 *
 * The writes it performs live in src/utils/staffAccounts.js — three of them,
 * with a rollback — and the note at the top of that file explains the order.
 */

// snake_case → "Team Lead"
const prettyRole = (r) =>
  String(r || "")
    .split("_")
    .map((w) => (w[0]?.toUpperCase() || "") + w.slice(1))
    .join(" ");

const EMPTY = { name: "", email: "", password: "", role: "developer" };

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export default function AddEmployeeDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const callerRole = getRole();

  // Mirrors the provision route's rule: you cannot grant a role at or above
  // your own. The route refuses it either way — this only keeps the dropdown
  // from offering a choice that comes back as a 403.
  const roles = useMemo(() => grantableStaffRoles(callerRole), [callerRole]);

  // If the caller cannot grant the default, start on something they can.
  const role = roles.includes(form.role) ? form.role : roles[0] || "";

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Derived, not stored: re-checked on every keystroke, so the message appears
  // while the field still has focus rather than after a failed submit.
  const nameError = validatePersonName(form.name);

  const close = () => {
    if (saving) return;
    setForm(EMPTY);
    onClose?.();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    const orgId = getOrgId();
    setSaving(true);
    try {
      const { error, code, developer } = await createStaffMember({
        orgId,
        actor: JSON.parse(sessionStorage.getItem("adminUser") || "null"),
        name: form.name,
        email: form.email,
        password: form.password,
        role,
      });

      if (error) {
        // A plan limit and a duplicate are both things the admin can act on,
        // so neither is dressed up as a failure.
        if (code === "plan_limit") showWarning("Plan limit reached", error);
        else if (code === "duplicate") showWarning("Already here", error);
        else if (code === "validation") showWarning("Almost there", error);
        else showError("Not created", error);
        return;
      }

      showSuccess(
        "Added",
        `${developer?.name || "They"} can sign in with that email and password.`
      );
      setForm(EMPTY);
      onClose?.();
      await onCreated?.();
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || !role;

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Add an employee"
      description="The account is created immediately and they can sign in with these details."
    >
      {/* autoComplete matters on every field here, and on the form itself.
          Three inputs called name / email / password in that order are exactly
          the shape a browser reads as "sign up" — so Chrome and Safari filled
          them with the SIGNED-IN ADMIN's own saved name, email and password.
          Nothing here ever seeds them: the state starts as empty strings and
          only setField writes to it. That is also why this must not be
          "fixed" by blanking state after mount — the browser puts the values
          there after paint, so the admin would watch their own details appear
          and then vanish, and a browser that re-fills on focus would simply do
          it again. `off` on the identity fields and `new-password` on the
          credential (this IS a new credential, for someone else) is the only
          thing that stops the fill happening at all. */}
      <form onSubmit={submit} className="space-y-4 px-5 py-5" autoComplete="off">
        <Field
          label="Full Name"
          htmlFor="employee-name"
          error={nameError || undefined}
          required
        >
          <Input
            id="employee-name"
            type="text"
            name="name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="Enter their full name"
            required
            autoComplete="off"
            disabled={disabled}
          />
        </Field>

        <Field label="Email" htmlFor="employee-email" required>
          <Input
            id="employee-email"
            type="email"
            name="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="Enter their email address"
            required
            autoComplete="off"
            disabled={disabled}
          />
        </Field>

        <Field
          label="Role"
          htmlFor="employee-role"
          hint={
            roles.length
              ? "Decides what they can see and do. It can be changed later from their profile."
              : "Your role cannot create accounts for anybody."
          }
          required
        >
          <select
            id="employee-role"
            name="role"
            value={role}
            onChange={(e) => setField("role", e.target.value)}
            className={selectClass}
            disabled={disabled}
            required
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {prettyRole(r)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Password"
          htmlFor="employee-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. They can change it from their account page.`}
          required
        >
          <Input
            id="employee-password"
            type="password"
            name="password"
            value={form.password}
            onChange={(e) => setField("password", e.target.value)}
            placeholder="Set their password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            disabled={disabled}
          />
        </Field>

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {saving ? "Adding…" : "Add employee"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
