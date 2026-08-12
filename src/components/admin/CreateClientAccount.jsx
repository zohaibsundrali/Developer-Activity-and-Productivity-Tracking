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
 * ORDER OF WRITES, AND WHY IT IS THIS ONE
 *
 * The `clients` row first, then the auth account, then the membership. If the
 * auth account cannot be created — a duplicate address, a plan limit — the
 * clients row is deleted again, because a client profile that can never sign in
 * is worse than no row: it shows up in every picker, can be linked to a
 * project, and silently receives nothing. That is the same rollback
 * createStaffMember (src/utils/staffAccounts.js) does, for the same reason.
 *
 * The membership is last and is NOT rolled back on failure: by then the account
 * works and the person can sign in. A missing membership row costs them a line
 * in Organization → Members, which is a cosmetic problem somebody can fix,
 * whereas undoing a working login is not.
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
      // 1) The profile row. `password` is deliberately NOT written: the column
      //    is a legacy plaintext field and the credential belongs to Supabase
      //    Auth, which stores it hashed.
      const { data: client, error: insertErr } = await supabase
        .from("clients")
        .insert({
          organization_id: orgId,
          name,
          email,
          company: form.company.trim() || null,
          phone: form.phone.trim() || null,
          status: "active",
        })
        .select("id, name, email")
        .single();

      if (insertErr) {
        if (insertErr.code === "23505") {
          throw new Error("A client with that email already exists.");
        }
        throw insertErr;
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
        // Roll the profile back before reporting, so a retry is not blocked by
        // the half-made row this attempt left behind.
        await supabase.from("clients").delete().eq("id", createdId);
        createdId = null;

        if (res.status === 402) {
          showWarning(
            payload?.error || "Plan limit reached",
            payload?.detail || "Your plan has no room for another client account."
          );
        } else {
          showError(
            "Account not created",
            payload?.error || "The login could not be created. Nothing was saved."
          );
        }
        return;
      }

      // 3) The membership, so they appear in Organization → Members like
      //    everyone else. Best-effort — see the note at the top of this file.
      const { error: memberErr } = await supabase.from("memberships").insert({
        organization_id: orgId,
        user_id: client.id,
        user_type: "client",
        role: "client",
        email,
        status: "active",
      });
      if (memberErr) {
        console.error("[CreateClientAccount] membership insert failed:", memberErr.message);
      }

      setForm({ name: "", email: "", company: "", phone: "", password: "" });
      showSuccess(
        "Client account created",
        `${name} can sign in now. Ask them to change the password from Account in their portal.`
      );
      reload?.();
    } catch (err) {
      if (createdId) {
        await supabase.from("clients").delete().eq("id", createdId);
      }
      showError("Account not created", err?.message || "Please try again.");
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
