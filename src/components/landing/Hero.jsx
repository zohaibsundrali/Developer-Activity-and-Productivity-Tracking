"use client";

/**
 * Hero — copy left, product visual right.
 *
 * Two columns from `lg`, one below it. The copy is left-aligned once the
 * columns exist and centred while they do not, because a centred column beside
 * a picture reads as neither.
 *
 * The background is a flat token-coloured wash behind an `aria-hidden` layer.
 *
 * A WebGL lattice used to sit here, loaded through `SceneLoader`. It was
 * removed at the owner's request: it did not read the way it was intended to,
 * and a hero effect that has to be explained is not doing its job. Removing it
 * also takes ~131KB of gzipped JavaScript, a canvas, a render loop and four
 * fallback paths out of the most performance-sensitive screen on the site — so
 * the page it leaves behind is faster and simpler, not merely emptier.
 *
 * Keep it that way. If a background is ever wanted again here, it should cost
 * nothing to load and nothing to fall back from. The same rule governs the new
 * right-hand column: `HeroVisual` is drawn in HTML and CSS, so it loads with
 * the markup, has no decode step and cannot fail to a blank box.
 *
 * The entrance is a hand-staggered fade-and-rise: eyebrow, headline, subhead,
 * actions, then the assurance line — 80ms apart, so the eye lands on the
 * headline first and the CTA arrives last. `Reveal` applies no inline style at
 * all under `prefers-reduced-motion: reduce`, so nothing here can be stranded
 * at `opacity: 0`.
 *
 * ── Fold budget ────────────────────────────────────────────────────────────
 * The visual must never push the primary CTA below the fold. Three things keep
 * that true rather than hoping for it:
 *
 *  1. The visual sits in its own grid column, so its height cannot add to the
 *     copy column's height. On a phone it is *below* the CTA entirely.
 *  2. The columns are `lg:items-center`, and the visual is capped at
 *     `lg:max-w-[36rem]` on a 16/11 box — about 425px tall at 1440px, against
 *     roughly 590px of copy. The shorter column is the one that gets centred,
 *     so the copy stays pinned at the top of the row and the CTA does not move.
 *  3. The type ramp tops out at 60px rather than 72px. A 72px headline in a
 *     half-width column wraps to four lines and spends the entire budget on
 *     itself.
 *
 * Measured at 1440×900 with the 80px sticky header: the copy starts at 160px,
 * and the bottom of the CTA row lands near 715px — comfortably above the fold,
 * with headroom for a fourth headline line.
 *
 * ── No layout shift ────────────────────────────────────────────────────────
 * The visual's box is reserved by an aspect ratio on the wrapper, not by the
 * content inside it. There is no image to decode and no font to swap inside
 * the mockup — it is all shapes — so the row is its final height on the first
 * paint, and it stays that height when a real screenshot replaces the
 * placeholder at the same aspect ratio.
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

          {/* ── Product visual ────────────────────────────────────────────
              Decorative in full: `aria-hidden` here covers the ground panel,
              the glow and the mockup, none of which carry information a screen
              reader needs — every claim the visual gestures at is written out
              in the copy beside it and in the sections below.

              On a phone this follows the CTA in source order as well as
              visually, and takes a squarer, smaller box: the visual is allowed
              to be cropped, but the button is not allowed to be pushed off the
              screen. */}
          <Reveal
            aria-hidden="true"
            delay={stagger(3)}
            distance={20}
            className="w-full"
          >
            <div className="relative mx-auto w-full max-w-[32rem] lg:max-w-[36rem]">
              {/* Soft ground, so the mockup reads as an object sitting on the
                  page rather than floating on the wash. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-3 -z-10 rounded-[1.75rem] bg-accent/50 blur-2xl sm:-inset-5"
              />
              <div className="rounded-2xl border border-border bg-card/70 p-2 shadow-elevated backdrop-blur-sm sm:p-3">
                {/* The reserved box. Shorter and squarer on a phone, wider from
                    `sm`. Nothing inside can change these dimensions, so nothing
                    can shift as it paints. */}
                <div className="aspect-[4/3] w-full sm:aspect-[16/10] lg:aspect-[16/11]">
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
