"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { User, Mail, ShieldCheck, Eye, EyeOff, CheckCircle, AlertTriangle, LockKeyhole } from "lucide-react";

const MIN_PASSWORD_LENGTH = 8;

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

export default function Account({ user }) {
  const name = useMemo(() => normalizeString(user?.name) || "—", [user?.name]);
  const email = useMemo(() => normalizeString(user?.email) || "—", [user?.email]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const validateClient = () => {
    const errors = {};

    if (!currentPassword) errors.currentPassword = "Current password is required.";

    if (!newPassword) {
      errors.newPassword = "New password is required.";
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      errors.newPassword = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (!confirmNewPassword) {
      errors.confirmNewPassword = "Please confirm your new password.";
    } else if (newPassword && confirmNewPassword !== newPassword) {
      errors.confirmNewPassword = "New password and confirmation do not match.";
    }

    if (currentPassword && newPassword && currentPassword === newPassword) {
      errors.newPassword = "New password must be different from current password.";
    }

    return errors;
  };

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setFieldErrors({});
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessMessage("");
    setFormError("");

    const errors = validateClient();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      setIsSubmitting(true);

      const res = await fetch("/api/developer/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          developerId: user?.id,
          currentPassword,
          newPassword,
          confirmNewPassword
        })
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.success) {
        const message = payload?.error || "Failed to update password. Please try again.";
        setFormError(message);
        return;
      }

      setSuccessMessage("Password updated successfully.");
      resetForm();
      setIsFormOpen(false);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="rounded-xl border border-border bg-card shadow-card">
        <CardHeader>
          <CardTitle className="text-xl font-semibold tracking-tight text-foreground">Account Information</CardTitle>
          <CardDescription className="text-[15px] text-muted-foreground">Your profile details.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted/50 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <User className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Name</p>
            <p className="mt-1 text-sm font-semibold text-foreground break-words">{name}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/50 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Email</p>
            <p className="mt-1 text-sm font-semibold text-foreground break-words">{email}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="h-1.5 bg-primary" />
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Change Password
            </CardTitle>
            <CardDescription className="text-[15px] text-muted-foreground">
              Choose a strong password (at least {MIN_PASSWORD_LENGTH} characters).
            </CardDescription>
          </div>
          <Button
            variant={isFormOpen ? "outline" : "default"}
            className={isFormOpen
              ? "h-10 border-border bg-card px-4 text-foreground hover:bg-muted"
              : "h-10 bg-primary px-4 text-primary-foreground hover:bg-primary/90"}
            onClick={() => {
              setSuccessMessage("");
              setFormError("");
              setFieldErrors({});
              setIsFormOpen((v) => !v);
            }}
            disabled={isSubmitting}
          >
            {isFormOpen ? "Cancel" : "Change Password"}
          </Button>
        </CardHeader>

        {successMessage && (
          <CardContent className="pt-0">
            <Alert variant="default" className="border-success/30 bg-success/10">
              <CheckCircle className="h-4 w-4 text-success" />
              <AlertTitle className="text-success">Success</AlertTitle>
              <AlertDescription className="text-success">{successMessage}</AlertDescription>
            </Alert>
          </CardContent>
        )}

        {isFormOpen && (
          <CardContent className="pb-6 pt-1">
            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              {formError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="current-password" className="text-foreground">Current Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className={`h-11 rounded-xl border-input bg-background pl-9 pr-11 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 ${
                      fieldErrors.currentPassword ? "border-destructive" : ""
                    }`}
                    autoComplete="current-password"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowCurrentPassword((v) => !v)}
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {fieldErrors.currentPassword && (
                  <p className="text-sm text-destructive">{fieldErrors.currentPassword}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-foreground">New Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={`h-11 rounded-xl border-input bg-background pl-9 pr-11 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 ${
                      fieldErrors.newPassword ? "border-destructive" : ""
                    }`}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowNewPassword((v) => !v)}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {fieldErrors.newPassword && (
                  <p className="text-sm text-destructive">{fieldErrors.newPassword}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password" className="text-foreground">Confirm New Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm-new-password"
                    type={showConfirmNewPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className={`h-11 rounded-xl border-input bg-background pl-9 pr-11 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 ${
                      fieldErrors.confirmNewPassword ? "border-destructive" : ""
                    }`}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowConfirmNewPassword((v) => !v)}
                  >
                    {showConfirmNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {fieldErrors.confirmNewPassword && (
                  <p className="text-sm text-destructive">{fieldErrors.confirmNewPassword}</p>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
                <Button
                  type="submit"
                  className="h-11 px-6 text-[15px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Updating..." : "Update Password"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-6 text-[15px] border-border text-foreground hover:bg-muted"
                  onClick={() => {
                    resetForm();
                    setIsFormOpen(false);
                  }}
                  disabled={isSubmitting}
                >
                  Close
                </Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
