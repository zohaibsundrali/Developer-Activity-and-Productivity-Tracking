"use client";

import { Fragment, useState } from "react";
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
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {pricing.plans.map((plan) => {
            const price = annual && plan.annualPrice ? plan.annualPrice : plan.price;
            const href = plan.code === "enterprise" ? salesUrl : plan.cta.href;
            return <li key={plan.code} className={`relative flex flex-col rounded-2xl bg-card p-6 shadow-card ${plan.highlight ? "border-2 border-primary" : "border border-border"}`}>
              {plan.badge && <span className="absolute -top-3 left-6 rounded-full border border-primary bg-accent px-3 py-1 text-xs font-semibold">{plan.badge}</span>}
              <h3 className="font-display text-xl font-semibold">{plan.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
              <p aria-live="polite" className="mt-6"><span className="font-display text-4xl font-semibold tracking-tight">${price}</span><span className="text-sm text-muted-foreground">/mo</span></p>
              <p className="mb-6 mt-2 min-h-10 text-xs text-muted-foreground">{annual && plan.annualPrice ? `$${price * 12} billed annually per organization` : plan.price === 0 ? "Free to start" : "Billed monthly per organization"}</p>
              {href ? <CtaButton href={href} variant={plan.highlight ? "primary" : "secondary"} size="md" className="mt-auto w-full px-3 text-center">{plan.cta.label}</CtaButton> : <button type="button" disabled title="Sales contact form is not configured yet" className="mt-auto min-h-11 rounded-lg border border-border px-3 py-3 text-sm font-semibold opacity-60">{plan.cta.label}</button>}
            </li>;
          })}
        </ul>
        <div role="region" aria-label="Plan comparison, scroll horizontally to compare all plans" tabIndex={0} className="mt-12 overflow-x-auto rounded-2xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <caption className="sr-only">Compare limits and features across all four Verisade plans</caption>
            <thead><tr className="border-b border-border bg-card"><th scope="col" className="p-5 text-left">Compare plans</th>{pricing.plans.map((plan) => <th key={plan.code} scope="col" className={`p-5 text-center ${plan.highlight ? "bg-accent" : ""}`}>{plan.name}</th>)}</tr></thead>
            <tbody>{groups.map((group) => <Fragment key={group.title}>
              <tr className="border-y border-border bg-muted"><th scope="rowgroup" colSpan={5} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider">{group.title}</th></tr>
              {group.rows.map(([label, ...values]) => <tr key={label} className="border-b border-border last:border-0"><th scope="row" className="max-w-sm px-5 py-4 text-left font-normal">{label}</th>{values.map((value, index) => <td key={index} className={`px-5 py-4 text-center ${index === 1 ? "bg-accent" : ""}`}>{typeof value === "boolean" ? <><span className="sr-only">{value ? "Included" : "Not included"}</span>{value ? <Check aria-hidden="true" className="mx-auto h-4 w-4 text-success" /> : <X aria-hidden="true" className="mx-auto h-4 w-4 text-muted-foreground" />}</> : value}</td>)}</tr>)}
            </Fragment>)}</tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}
