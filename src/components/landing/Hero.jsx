"use client";

/**
 * Hero.
 *
 * The 3D lattice from `SceneLoader` sits behind the copy as an absolutely
 * positioned, `aria-hidden` layer. It is deliberately *behind* and not *beside*
 * the text: at 375px a side-by-side hero either shrinks the headline to nothing
 * or pushes the CTA below the fold, and this way the scene degrades to a
 * background texture on a phone with no layout change at all.
 *
 * `SceneLoader` owns its own reduced-motion / mobile / no-WebGL fallbacks, so
 * this file never asks what the visitor's preferences are — it just gives the
 * loader a positioned box to fill. The box is `absolute` inside an
 * `overflow-hidden` parent and has its height fixed up front, so the scene can
 * neither shift layout nor widen the document while it loads.
 *
 * The entrance is a hand-staggered fade-and-rise: eyebrow, headline, subhead,
 * actions, then the assurance line — 80ms apart, so the eye lands on the
 * headline first and the CTA arrives last.
 */

import SceneLoader from "@/components/landing/SceneLoader";
import { CtaButton, Reveal, stagger } from "@/components/landing/primitives";
import { cta, hero, pick } from "@/components/landing/content";

export default function Hero() {
  if (!hero) return null;

  const eyebrow = pick(hero, "eyebrow", "kicker", "badge", "label", "tag", "announcement");
  const headline = pick(hero, "headline", "title", "heading", "h1");
  const subhead = pick(hero, "subhead", "description", "subtitle", "body", "copy");

  const primary = cta(hero.primaryCta ?? hero.primary ?? hero.cta);
  const secondary = cta(hero.secondaryCta ?? hero.secondary);
  // A short reassurance the author attached to the button itself, e.g. what the
  // free plan costs. Rendered under the actions rather than inside the button.
  const primaryNote = pick(hero.primaryCta ?? {}, "sublabel", "note", "caption", "hint");
  // The price belongs above the fold, not four sections down in the pricing
  // table — a visitor deciding whether to read on is deciding on the number.
  const priceLine = pick(hero, "priceLine", "price", "pricing");

  if (!headline && !subhead && !primary) return null;

  return (
    <section
      id="top"
      aria-labelledby={headline ? "hero-heading" : undefined}
      className="relative isolate overflow-hidden bg-background"
    >
      {/*
        Scene layer. A fixed-height box reserved before anything loads, so the
        arrival of the canvas cannot move a single pixel of the copy.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 select-none">
        <div className="absolute inset-x-0 top-0 h-[38rem] sm:h-[46rem] lg:h-[54rem]">
          <SceneLoader />
        </div>
        {/* Settles the lattice behind the text without touching its colours. */}
        <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-background via-background/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 pb-24 pt-14 sm:px-6 sm:pb-28 sm:pt-20 lg:px-8 lg:pb-36 lg:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          {eyebrow ? (
            <Reveal delay={0} distance={16}>
              <p className="mx-auto inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 shadow-card backdrop-blur-sm">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                />
                <span className="text-xs font-medium leading-snug tracking-[-0.005em] text-foreground sm:text-sm">
                  {eyebrow}
                </span>
              </p>
            </Reveal>
          ) : null}

          {headline ? (
            <Reveal delay={stagger(1)} distance={28}>
              <h1
                id="hero-heading"
                className={[
                  "font-display text-[2.75rem] font-bold leading-[1.03] tracking-[-0.04em] text-foreground",
                  "sm:text-6xl lg:text-[4.5rem]",
                  eyebrow ? "mt-8" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {headline}
              </h1>
            </Reveal>
          ) : null}

          {subhead ? (
            <Reveal delay={stagger(2)}>
              <p className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                {subhead}
              </p>
            </Reveal>
          ) : null}

          {priceLine ? (
            <Reveal delay={stagger(3)}>
              <p className="mx-auto mt-6 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 rounded-xl border border-primary/20 bg-accent px-4 py-2.5 text-sm font-medium leading-snug text-accent-foreground sm:text-base">
                {priceLine}
              </p>
            </Reveal>
          ) : null}

          {primary || secondary ? (
            <Reveal delay={stagger(4)}>
              <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                {primary ? (
                  <CtaButton href={primary.href} variant="primary" size="lg" showArrow>
                    {primary.label}
                  </CtaButton>
                ) : null}
                {secondary ? (
                  <CtaButton href={secondary.href} variant="secondary" size="lg">
                    {secondary.label}
                  </CtaButton>
                ) : null}
              </div>
            </Reveal>
          ) : null}

          {primaryNote ? (
            <Reveal delay={stagger(5)}>
              <p className="mt-5 text-sm text-muted-foreground">{primaryNote}</p>
            </Reveal>
          ) : null}
        </div>
      </div>
    </section>
  );
}
