"use client";

/**
 * How it works — a numbered sequence.
 *
 * The connecting rule between steps is a `::before`-free absolutely positioned
 * hairline rather than a border on the grid, so it can stop short of the first
 * and last markers instead of running off the ends. It is `aria-hidden`; the
 * ordered list carries the sequence semantically.
 *
 * Steps reveal in order at 80ms apart. On a wide viewport that reads as the
 * line drawing itself left to right, which is the point of staggering here
 * rather than revealing the row as one block.
 */

import {
  CARD_LIFT,
  CtaRow,
  IconChip,
  Reveal,
  SectionHeading,
  stagger,
} from "@/components/landing/primitives";
import { ctas, heading, howItWorks, items, pick, str } from "@/components/landing/content";

function stepList() {
  return items(howItWorks, "steps", "items", "list")
    .map((entry, index) => {
      if (typeof entry === "string") {
        const text = str(entry);
        return text ? { number: String(index + 1), title: text, description: null, icon: null } : null;
      }
      const title = pick(entry, "title", "name", "heading", "label");
      if (!title) return null;
      return {
        number: pick(entry, "number", "step", "index") ?? String(index + 1),
        title,
        description: pick(entry, "description", "body", "copy", "text", "detail"),
        icon: entry.icon ?? entry.iconName ?? null,
      };
    })
    .filter(Boolean);
}

export default function HowItWorks() {
  const steps = stepList();
  const { eyebrow, title, description } = heading(howItWorks);
  const actions = ctas(howItWorks);

  if (steps.length === 0 && !title) return null;

  return (
    <section
      id="how-it-works"
      aria-labelledby={title ? "how-it-works-heading" : undefined}
      className="relative isolate scroll-mt-20 overflow-hidden border-t border-border bg-muted/40 py-20 sm:py-24 lg:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          headingId={title ? "how-it-works-heading" : undefined}
          align="center"
        />

        {steps.length > 0 ? (
          <div className="relative mt-16 sm:mt-20">
            {/* The connecting rule sits on the vertical centre of the step
                markers: 24px card padding + 18px half-marker = 2.625rem. */}
            {steps.length > 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-[2.625rem] right-[2.625rem] top-[2.625rem] hidden h-px bg-gradient-to-r from-border via-primary/30 to-border lg:block"
              />
            ) : null}

            <ol
              className={[
                "relative grid gap-8 sm:gap-10",
                steps.length >= 4 ? "lg:grid-cols-4" : steps.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
                "sm:grid-cols-2",
              ].join(" ")}
            >
              {steps.map((step, index) => (
                <Reveal as="li" key={step.title} delay={stagger(index)} className="h-full">
                  <div
                    className={[
                      "flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-card",
                      CARD_LIFT,
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary text-sm font-semibold text-primary-foreground"
                      >
                        {step.number}
                      </span>
                      <IconChip icon={step.icon} className="h-9 w-9" />
                    </div>

                    <h3 className="mt-5 font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                      {step.title}
                    </h3>

                    {step.description ? (
                      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                        {step.description}
                      </p>
                    ) : null}
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        ) : null}

        {actions.length > 0 ? (
          <Reveal delay={stagger(1)}>
            <CtaRow actions={actions.slice(0, 1)} align="center" className="mt-14" />
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
