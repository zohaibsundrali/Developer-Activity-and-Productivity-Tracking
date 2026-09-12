"use client";

import { useState } from "react";
import { UserPlus, KeyRound } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess, showWarning } from "@/utils/alerts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Field,
  Input,
  Button,
} from "@/components/ui";

/**
 * Create a client account outright — name, email, password — as opposed to
 * inviting them and waiting for them to accept.
 *
 * Both paths exist on purpose. An invitation is the polite one and lets the
 * client choose their own password; this one is for when you are sitting with
 * them, or onboarding an account somebody has already agreed to, and want them
 * able to sign in this minute. The client can change the password and their
 * name from the portal afterwards.
 *
 * Save the profile first. The server then reserves a stable Auth identity and
 * atomically finalizes its link and active membership. Failed attempts preserve
 * the profile; resubmitting the same details resumes its sign-in setup.
 */

const MIN_PASSWORD = 8;

export default function CreateClientAccount({ reload }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    phone: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const password = form.password;

    if (!name || !email || !password) {
      showError("Almost there", "A name, an email address and a password are all needed.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      showError("Password too short", `Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    const orgId = getOrgId();
    if (!orgId) {
      showError("No organization", "Your session has no organization. Sign in again.");
      return;
    }

    setSaving(true);
    let createdId = null;

    try {
      const found = await supabase.from("clients").select("id, name, email")
        .eq("organization_id", orgId).ilike("email", email);
      if (found.error) throw new Error("Could not check saved profiles. Please retry.");
      if ((found.data || []).length > 1) throw new Error("Multiple profiles use this address. Administrator review is required.");
      let client = found.data?.[0];
      if (!client) {
        const inserted = await supabase.from("clients").insert({
          organization_id: orgId, name, email, company: form.company.trim() || null,
          phone: form.phone.trim() || null, status: "active",
        }).select("id, name, email").single();
        if (inserted.error || !inserted.data?.id) throw inserted.error || new Error("Profile could not be saved.");
        client = inserted.data;
      }
      createdId = client.id;

      // 2) The login.
      const res = await authFetch("/api/auth/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          role: "client",
          userType: "client",
          appUserId: client.id,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        // Keep the saved profile: a timed-out provider request may still finish.

        if (res.status === 402) {
          showWarning(
            payload?.error || "Plan limit reached",
            payload?.detail || "Your plan has no room for another client account."
          );
        } else {
          showError(
            "Account not created",
            payload?.error || "The profile is saved. Retry the same details to finish sign-in setup."
          );
        }
        return;
      }

      const completed = await res.json().catch(() => null);
      if (!completed?.success || !completed.userId) throw new Error("Completion could not be verified. Retry the same details.");
      if (completed.alreadyExists) {
        showWarning("Already linked", "This account already has sign-in. Its password was not changed; use password recovery if needed.");
        return;
      }

      setForm({ name: "", email: "", company: "", phone: "", password: "" });
      showSuccess(
        "Client account created",
        completed.passwordUnchanged ? "Sign-in setup is complete. Use the original password or password recovery; the retry did not change it." : `${name} can sign in now. Ask them to change the password from Account in their portal.`
      );
      reload?.();
    } catch (err) {
      showError("Sign-in setup incomplete", `${err?.message || "Please try again."}${createdId ? " The profile is saved; retry the same email." : ""}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus aria-hidden="true" className="h-4 w-4 text-primary" /> Create a client account
        </CardTitle>
        <CardDescription>
          They can sign in straight away. Use an invite instead if you would rather they set their
          own password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="new-client-name" required>
            <Input
              id="new-client-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Ayesha Khan"
              autoComplete="off"
              required
            />
          </Field>

          <Field label="Email" htmlFor="new-client-email" required>
            <Input
              id="new-client-email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="ayesha@company.com"
              autoComplete="off"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" htmlFor="new-client-company">
              <Input
                id="new-client-company"
                value={form.company}
                onChange={(e) => setField("company", e.target.value)}
                placeholder="Acme Ltd"
                autoComplete="off"
              />
            </Field>
            <Field label="Phone" htmlFor="new-client-phone">
              <Input
                id="new-client-phone"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="+92 300 0000000"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field
            label="Password"
            htmlFor="new-client-password"
            required
            hint={`At least ${MIN_PASSWORD} characters. They can change it from their portal.`}
          >
            <Input
              id="new-client-password"
              type="password"
              value={form.password}
              onChange={(e) => setField("password", e.target.value)}
              placeholder="Set an initial password"
              // `new-password`, not `current-password`: this IS a new
              // credential, for someone who is not the person typing, so a
              // password manager must never offer the admin's own here.
              autoComplete="new-password"
              required
            />
          </Field>

          <Button type="submit" disabled={saving} className="w-full">
            <KeyRound aria-hidden="true" className="h-4 w-4" />
            <span className="ml-1.5">{saving ? "Creating…" : "Create account"}</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
