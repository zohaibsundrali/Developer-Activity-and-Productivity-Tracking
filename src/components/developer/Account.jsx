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
      <Card className="border border-[#dbe6ff] bg-gradient-to-br from-white via-[#f8fbff] to-[#eef4ff] shadow-[0_12px_40px_-24px_rgba(37,99,235,0.55)]">
        <CardHeader>
          <CardTitle className="text-xl font-semibold tracking-tight">Account Information</CardTitle>
          <CardDescription className="text-[15px]">Your profile details.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#d9e5ff] bg-white/85 p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8f0ff] text-[#1e40af]">
              <User className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Name</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 break-words">{name}</p>
          </div>
          <div className="rounded-xl border border-[#d9e5ff] bg-white/85 p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8f0ff] text-[#1e40af]">
              <Mail className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Email</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 break-words">{email}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border border-[#dbe6ff] bg-white shadow-[0_16px_50px_-30px_rgba(15,23,42,0.45)]">
        <div className="h-1.5 bg-gradient-to-r from-[#1d4ed8] via-[#0284c7] to-[#0ea5e9]" />
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <ShieldCheck className="h-5 w-5 text-[#1d4ed8]" />
              Change Password
            </CardTitle>
            <CardDescription className="text-[15px]">
              Choose a strong password (at least {MIN_PASSWORD_LENGTH} characters).
            </CardDescription>
          </div>
          <Button
            variant={isFormOpen ? "outline" : "default"}
            className={isFormOpen
              ? "h-10 border-slate-300 bg-white px-4 text-slate-700 hover:bg-slate-50"
              : "h-10 bg-gradient-to-r from-[#1d4ed8] to-[#0284c7] px-4 text-white shadow-[0_10px_20px_-12px_rgba(29,78,216,0.9)] hover:from-[#1e40af] hover:to-[#0369a1]"}
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
            <Alert variant="default" className="border-green-300 bg-green-50/80">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-700">Success</AlertTitle>
              <AlertDescription className="text-green-700">{successMessage}</AlertDescription>
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
                <Label htmlFor="current-password" className="text-slate-700">Current Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className={`h-11 rounded-xl border-slate-300 bg-slate-50/80 pl-9 pr-11 text-[15px] text-slate-900 placeholder:text-slate-400 focus-visible:border-[#1d4ed8] focus-visible:ring-[#bfdbfe] ${
                      fieldErrors.currentPassword ? "border-red-500" : ""
                    }`}
                    autoComplete="current-password"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                    onClick={() => setShowCurrentPassword((v) => !v)}
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {fieldErrors.currentPassword && (
                  <p className="text-sm text-red-600">{fieldErrors.currentPassword}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-slate-700">New Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={`h-11 rounded-xl border-slate-300 bg-slate-50/80 pl-9 pr-11 text-[15px] text-slate-900 placeholder:text-slate-400 focus-visible:border-[#1d4ed8] focus-visible:ring-[#bfdbfe] ${
                      fieldErrors.newPassword ? "border-red-500" : ""
                    }`}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                    onClick={() => setShowNewPassword((v) => !v)}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {fieldErrors.newPassword && (
                  <p className="text-sm text-red-600">{fieldErrors.newPassword}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password" className="text-slate-700">Confirm New Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="confirm-new-password"
                    type={showConfirmNewPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className={`h-11 rounded-xl border-slate-300 bg-slate-50/80 pl-9 pr-11 text-[15px] text-slate-900 placeholder:text-slate-400 focus-visible:border-[#1d4ed8] focus-visible:ring-[#bfdbfe] ${
                      fieldErrors.confirmNewPassword ? "border-red-500" : ""
                    }`}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                    onClick={() => setShowConfirmNewPassword((v) => !v)}
                  >
                    {showConfirmNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {fieldErrors.confirmNewPassword && (
                  <p className="text-sm text-red-600">{fieldErrors.confirmNewPassword}</p>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
                <Button
                  type="submit"
                  className="h-11 px-6 text-[15px] font-semibold bg-gradient-to-r from-[#1d4ed8] to-[#0284c7] text-white shadow-[0_12px_24px_-14px_rgba(29,78,216,0.9)] hover:from-[#1e40af] hover:to-[#0369a1]"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Updating..." : "Update Password"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-6 text-[15px] border-slate-300 text-slate-700 hover:bg-slate-50"
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
