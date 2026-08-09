"use client";

/**
 * Closing call to action.
 *
 * Full-bleed brand ground — the only place on the page where indigo is the
 * background rather than an accent — so the last thing before the footer reads
 * as a deliberate end rather than one more section.
 *
 * The decorative field behind it parallaxes slowly; it is `aria-hidden`, sits
 * inside `overflow-hidden`, and is inset far enough that its travel never
 * reaches an edge.
 */

import { Container, CtaRow, Reveal, stagger } from "@/components/landing/primitives";
import { bullets, ctas, finalCta, pick } from "@/components/landing/content";
import { useParallax } from "@/hooks/useParallax";

export default function FinalCta() {
  const { sectionRef, layerRef } = useParallax({ distance: 60 });

  const eyebrow = pick(finalCta, "eyebrow", "kicker", "label", "tag");
  const title = pick(finalCta, "title", "heading", "headline");
  const description = pick(finalCta, "description", "subhead", "body", "copy", "subtitle");
  const actions = ctas(finalCta);
  const notes = bullets(finalCta, "notes", "assurances", "footnotes", "points");
  // A single reassurance sentence, as opposed to a list of them.
  const reassurance = pick(finalCta, "reassurance", "note", "footnote", "assurance");

  if (!title && actions.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={title ? "final-cta-heading" : undefined}
      className="relative isolate overflow-hidden bg-primary py-20 text-primary-foreground sm:py-24 lg:py-28"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div ref={layerRef} className="absolute inset-x-0 -top-32 -bottom-32">
          <div className="absolute left-1/2 top-0 h-[34rem] w-[34rem] max-w-[150%] -translate-x-1/2 rounded-full bg-primary-foreground/10 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-[26rem] w-[26rem] max-w-[130%] -translate-x-1/3 rounded-full bg-sidebar/20 blur-3xl" />
        </div>
      </div>

      <Container>
        <div className="mx-auto max-w-3xl text-center">
          {eyebrow ? (
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">
                {eyebrow}
              </p>
            </Reveal>
          ) : null}

          {title ? (
            <Reveal delay={eyebrow ? stagger(1) : 0}>
              <h2
                id="final-cta-heading"
                className={[
                  "font-display text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-primary-foreground sm:text-4xl lg:text-5xl",
                  eyebrow ? "mt-4" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {title}
              </h2>
            </Reveal>
          ) : null}

          {description ? (
            <Reveal delay={stagger(2)}>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-primary-foreground/80 sm:text-lg">
                {description}
              </p>
            </Reveal>
          ) : null}

          {actions.length > 0 ? (
            <Reveal delay={stagger(3)}>
              <CtaRow actions={actions} ground="brand" size="lg" align="center" className="mt-10" />
            </Reveal>
          ) : null}

          {notes.length > 0 ? (
            <Reveal delay={stagger(4)}>
              <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                {notes.map((note) => (
                  <li key={note.text} className="text-sm text-primary-foreground/75">
                    {note.text}
                  </li>
                ))}
              </ul>
            </Reveal>
          ) : null}

          {reassurance ? (
            <Reveal delay={stagger(4)}>
              <p className="mx-auto mt-8 max-w-xl text-sm leading-relaxed text-primary-foreground/75">
                {reassurance}
              </p>
            </Reveal>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
