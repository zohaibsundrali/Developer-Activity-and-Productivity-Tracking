"use client";

/**
 * Hero copy and actions stay above the visual on mobile.
 * The image keeps its original aspect ratio at every screen size.
 */

import { Container, CtaButton, Reveal, stagger } from "@/components/landing/primitives";
import { cta, hero, pick } from "@/components/landing/content";
import HeroVisual from "@/components/landing/HeroVisual";

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
        Background. The WebGL lattice that used to sit here was removed at the
        owner's request — it did not read the way it was meant to. What is left
        is a flat token-coloured wash: no canvas, no animation, nothing to load,
        and nothing that can move the copy once it has painted.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 select-none">
        <div className="absolute inset-x-0 top-0 h-[38rem] bg-gradient-to-b from-accent/40 via-background to-background sm:h-[46rem] lg:h-[54rem]" />
      </div>

      <Container className="pb-20 pt-12 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-20">
        <div className="grid grid-cols-1 items-start gap-x-10 gap-y-12 lg:grid-cols-2 lg:items-center lg:gap-y-0 xl:gap-x-16">
          {/* ── Copy ──────────────────────────────────────────────────────
              Keeps its own measure below `lg`, where it is the whole width of
              the page — a headline set across 1400px is not a headline. From
              `lg` the grid column *is* the measure. */}
          <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:max-w-none lg:text-left">
            {eyebrow ? (
              <Reveal delay={0} distance={16}>
                <p className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 shadow-card backdrop-blur-sm">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" style={{ backgroundColor: "hsl(243 60% 35%)" }}
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
                    "font-display text-[2.5rem] font-bold leading-[1.05] tracking-[-0.04em] text-foreground",
                    // The ramp stops at 60px on purpose: see the fold budget note.
                    "sm:text-5xl lg:text-[3.25rem] xl:text-[3.75rem]",
                    eyebrow ? "mt-7" : "",
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
                <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0 lg:max-w-xl">
                  {subhead}
                </p>
              </Reveal>
            ) : null}

            {priceLine ? (
              <Reveal delay={stagger(3)}>
                <p className="mt-6 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 rounded-xl border border-primary/20 bg-accent px-4 py-2.5 text-sm font-medium leading-snug text-accent-foreground sm:text-base lg:justify-start">
                  {priceLine}
                </p>
              </Reveal>
            ) : null}

            {primary || secondary ? (
              <Reveal delay={stagger(4)}>
                <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start">
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
                <p className="mt-4 text-sm text-muted-foreground">{primaryNote}</p>
              </Reveal>
            ) : null}
          </div>

          {/* Decorative illustration beside the hero copy. */}
          <Reveal
            aria-hidden="true"
            delay={stagger(3)}
            distance={20}
            className="w-full"
          >
            <div className="relative mx-auto w-full max-w-[32rem] lg:max-w-[36rem]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-3 -z-10 rounded-[1.75rem] bg-accent/50 blur-2xl sm:-inset-5"
              />
              <div className="rounded-2xl border border-border bg-card/70 p-2 shadow-elevated backdrop-blur-sm sm:p-3">
                <div className="aspect-[189/130] w-full">
                  <HeroVisual />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
