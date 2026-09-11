"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/utils/authFetch";
import { Button } from "@/components/ui";

export default function PlanFeatureBoundary({ feature, children, accountHref }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    (async () => {
      try {
        const response = await authFetch(`/api/billing/feature?feature=${encodeURIComponent(feature)}`);
        const body = await response.json();
        if (active) setResult(response.ok && body.allowed ? { allowed: true } : {
          error: body.detail || body.error || "Feature access could not be verified.",
          restricted: response.status === 402,
        });
      } catch {
        if (active) setResult({ error: "Feature access could not be verified. Please retry." });
      }
    })();
    return () => { active = false; };
  }, [feature, attempt]);
  if (!result) return <div role="status" className="p-6">Checking plan access…</div>;
  if (!result.allowed) return (
    <div role="alert" className="m-6 space-y-4 rounded-xl border border-border bg-card p-6">
      <p>{result.error}</p>
      {result.restricted && <p>Contact your organization owner to update the subscription.</p>}
      <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button>
      {accountHref && <p><Link href={accountHref}>Open your account</Link></p>}
    </div>
  );
  return children;
}
