"use client";

import { useState } from "react";
import { Save, KeyRound } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";
import { Panel } from "./ClientShared";
import { Button, Field, Input } from "@/components/ui";

/**
 * The editable half of the client's Account screen.
 *
 * Two separate forms on purpose. Changing your name and changing your password
 * are different acts with different risks, and one Save button covering both
 * means a typo in the password field can block a name change — or worse, that
 * somebody who only meant to fix a spelling is asked for a password.
 */

const MIN_PASSWORD = 8;

export function ClientProfileForm({ user, onSaved }) {
  const [form, setForm] = useState({
    name: user?.name || user?.full_name || "",
    company: user?.company || "",
    phone: user?.phone || "",
  });
  const [saving, setSaving] = useState(false);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      showError("Name required", "This is what everyone sees beside your messages.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/client/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          company: form.company.trim(),
          phone: form.phone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save your details.");
      showSuccess("Saved", "Your details have been updated.");
      onSaved?.(json.client);
    } catch (err) {
      showError("Not saved", err?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="p-5">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Your details</h2>
      <p className="mt-1 text-[15px] text-muted-foreground">
        Your email is how you sign in — ask your project contact if it needs to change.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Name" htmlFor="client-name" required>
          <Input
            id="client-name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            maxLength={200}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" htmlFor="client-company">
            <Input
              id="client-company"
              value={form.company}
              onChange={(e) => setField("company", e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field label="Phone" htmlFor="client-phone">
            <Input
              id="client-phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              maxLength={200}
            />
          </Field>
        </div>
        <Button type="submit" disabled={saving}>
          <Save aria-hidden="true" className="h-4 w-4" />
          <span className="ml-1.5">{saving ? "Saving…" : "Save details"}</span>
        </Button>
      </form>
    </Panel>
  );
}

export function ClientPasswordForm({ email }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    if (next.length < MIN_PASSWORD) {
      showError("Too short", `Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (next !== confirm) {
      showError("They do not match", "The two new passwords are different.");
      return;
    }
    if (next === current) {
      showError("That is the same password", "Choose one you have not used here before.");
      return;
    }

    setSaving(true);
    try {
      // The current password is checked FIRST, by signing in with it.
      //
      // Supabase would let a live session set a new password without it. That
      // is one unattended laptop away from someone taking the account — the
      // person who walks up does not know the old password, and requiring it
      // is the only thing standing between them and locking the owner out.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (signInErr) {
        showError("Current password is wrong", "Check it and try again.");
        return;
      }

      // Straight to Supabase Auth. The new password never travels to our own
      // server, so it cannot land in a log there.
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;

      setCurrent("");
      setNext("");
      setConfirm("");
      showSuccess("Password changed", "Use the new one next time you sign in.");
    } catch (err) {
      showError("Not changed", err?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="p-5">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Password</h2>
      <p className="mt-1 text-[15px] text-muted-foreground">
        If your account was set up for you, change the password you were given.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Current password" htmlFor="client-current-password" required>
          <Input
            id="client-current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="New password"
            htmlFor="client-new-password"
            required
            hint={`At least ${MIN_PASSWORD} characters.`}
          >
            <Input
              id="client-new-password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Repeat it" htmlFor="client-confirm-password" required>
            <Input
              id="client-confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        <Button type="submit" disabled={saving}>
          <KeyRound aria-hidden="true" className="h-4 w-4" />
          <span className="ml-1.5">{saving ? "Changing…" : "Change password"}</span>
        </Button>
      </form>
    </Panel>
  );
}
