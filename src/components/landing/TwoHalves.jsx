"use client";

import { ArrowRight, Check, LayoutDashboard, Monitor, MousePointer2, Keyboard, Clock3 } from "lucide-react";
import { Container, SectionHeading } from "@/components/landing/primitives";
import { extras } from "@/components/landing/content";

export default function TwoHalves() {
  const content = extras.twoHalves;
  return <section id={content.id} aria-labelledby="two-halves-heading" className="scroll-mt-20 border-t border-border bg-background py-20 sm:py-24">
    <Container>
      <SectionHeading eyebrow={content.eyebrow} title={content.title} description={content.description} headingId="two-halves-heading" align="center" />
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {content.columns.map((half, index) => {
          const Icon = index === 0 ? LayoutDashboard : Monitor;
          return <article key={half.title} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3"><div className="rounded-xl bg-accent p-3"><Icon className="h-6 w-6 text-primary" aria-hidden="true" /></div><span className="text-xs font-semibold uppercase tracking-wider">{index === 0 ? "Organize the work" : "Understand the workday"}</span></div>
              <h3 className="mt-6 font-display text-2xl font-semibold">{half.title}</h3>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{half.description}</p>
            </div>
            <div aria-hidden="true" className="mx-6 mb-6 rounded-xl border border-border bg-muted p-4 sm:mx-8 sm:mb-8">
              <p className="mb-4 text-xs font-medium text-muted-foreground">{index === 0 ? "A clear path to delivery" : "Workday insights at a glance"}</p>
              {index === 0 ? <div className="grid grid-cols-3 gap-2">{["To do", "In progress", "In review"].map((label, i) => <div key={label} className="rounded-lg border border-border bg-card p-3"><p className="text-xs font-semibold">{label}</p><div className="mt-4 h-1.5 w-4/5 rounded bg-primary/20" /><div className="mt-2 h-1.5 w-3/5 rounded bg-primary/10" /><div className="mt-4 flex justify-end">{i === 2 ? <Check className="h-4 w-4 text-success" /> : <ArrowRight className="h-4 w-4 text-primary" />}</div></div>)}</div> : <div className="grid grid-cols-3 gap-2">{[[Keyboard, "Keyboard"], [MousePointer2, "Mouse"], [Clock3, "Active time"]].map(([Signal, label]) => <div key={label} className="rounded-lg border border-border bg-card p-3"><Signal className="h-5 w-5 text-primary" /><p className="mt-3 text-xs font-semibold">{label}</p><div className="mt-3 flex h-5 items-end gap-1">{[40, 75, 55, 100, 65].map((height, i) => <span key={i} className="flex-1 rounded-sm bg-primary/30" style={{height: `${height}%`}} />)}</div></div>)}</div>}
            </div>
          </article>;
        })}
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-base font-medium leading-relaxed">{content.spine}</p>
    </Container>
  </section>;
}
