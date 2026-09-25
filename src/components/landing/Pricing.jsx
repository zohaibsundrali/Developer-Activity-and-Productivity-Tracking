"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Container, CtaButton, SectionHeading } from "@/components/landing/primitives";
import { pricing } from "@/components/landing/content";

const groups = [
  { title: "Limits", rows: [
    ["People", "3", "25", "100", "Unlimited"],
    ["Projects", "2", "25", "150", "Unlimited"],
    ["Open tasks", "50", "2,000", "20,000", "Unlimited"],
  ] },
  { title: "Core", rows: [
    "Board views — kanban, list, table, calendar, timeline",
    "Epics, sprints, story points, burndown",
    "Task review with file submissions",
    "Activity tracking + dashboard",
    "Reports — CSV & PDF export",
    "Automation rules",
    "Due-date reminders & recurring tasks",
  ].map((label) => [label, true, true, true, true]) },
  { title: "Collaboration", rows: [
    ["Email actions in automation", false, true, true, true],
    ["Client portal logins", false, true, true, true],
    ["Multi-team support", false, false, true, true],
  ] },
];

export default function Pricing() {
  const [annual, setAnnual] = useState(false);
  const salesUrl = process.env.NEXT_PUBLIC_SALES_CONTACT_URL || "/contact";
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-20 border-t border-border bg-background py-20 sm:py-24 lg:py-32">
      <Container>
        <SectionHeading title={pricing.title} description="Start small. Build momentum. Choose the room your team needs, with core project tools on every plan." headingId="pricing-heading" align="center" />
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <div role="group" aria-label="Billing interval" className="inline-flex rounded-xl border border-border bg-muted p-1">
            {[false, true].map((value) => <button key={String(value)} type="button" aria-pressed={annual === value} onClick={() => setAnnual(value)} className={`rounded-lg px-5 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${annual === value ? "bg-card shadow-card" : ""}`}>{value ? "Annual" : "Monthly"}</button>)}
          </div>
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">Save 20%</span>
        </div>
        <ul className="mt-12 grid items-stretch gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
          {pricing.plans.map((plan, planIndex) => {
            const price = annual && plan.annualPrice ? plan.annualPrice : plan.price;
            const href = plan.code === "enterprise" ? salesUrl : plan.cta.href;
            return <li key={plan.code} className={`relative flex min-w-0 flex-col rounded-2xl border bg-card p-5 shadow-card sm:p-6 ${plan.highlight ? "border-primary ring-1 ring-primary" : "border-border"}`}>
              {plan.badge && <span className="absolute -top-3 left-6 rounded-full border border-primary bg-accent px-3 py-1 text-xs font-semibold">{plan.badge}</span>}
              <h3 className="font-display text-xl font-semibold">{plan.name}</h3>
              <p className="mt-2 text-sm leading-5 text-muted-foreground sm:min-h-10">{plan.description}</p>
              <p aria-live="polite" className="mt-6"><span className="font-display text-4xl font-semibold tracking-tight">${price}</span><span className="text-sm text-muted-foreground">/mo</span></p>
              <p className="mt-2 sm:min-h-10 text-xs leading-5 text-muted-foreground">{annual && plan.annualPrice ? `$${price * 12} billed annually per organization` : plan.price === 0 ? "Free to start" : "Billed monthly per organization"}</p>
              <div className="my-5 space-y-5 border-t border-border pt-5">
                {groups.map((group) => (
                  <section key={group.title} aria-labelledby={`${plan.code}-${group.title.toLowerCase()}`}>
                    <h4 id={`${plan.code}-${group.title.toLowerCase()}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</h4>
                    {group.title === "Limits" ? (
                      <dl className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
                        {group.rows.map(([label, ...values]) => (
                          <div key={label} className="flex items-baseline justify-between gap-3">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="font-semibold tabular-nums">{values[planIndex]}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <ul className="space-y-2.5">
                        {group.rows.map(([label, ...values]) => {
                          const included = values[planIndex];
                          const Icon = included ? Check : X;
                          return (
                            <li key={label} className={`flex items-start gap-2 text-sm leading-5 ${included ? "text-foreground" : "text-muted-foreground"}`}>
                              <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${included ? "text-success" : "text-muted-foreground"}`} />
                              <span><span className="sr-only">{included ? "Included: " : "Not included: "}</span>{label}{!included && <span aria-hidden="true" className="block text-xs">Not included</span>}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
              <div className="mt-auto border-t border-border pt-5">
                {href ? <CtaButton href={href} variant={plan.highlight ? "primary" : "secondary"} size="md" className="w-full px-3 text-center">{plan.cta.label}</CtaButton> : <button type="button" disabled title="Sales contact form is not configured yet" className="min-h-11 w-full rounded-lg border border-border px-3 py-3 text-sm font-semibold opacity-60">{plan.cta.label}</button>}
              </div>
            </li>;
          })}
        </ul>
      </Container>
    </section>
  );
}
