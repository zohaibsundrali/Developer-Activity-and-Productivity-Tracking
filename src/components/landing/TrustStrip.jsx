"use client";

/**
 * Trust strip, directly under the hero.
 *
 * The content module ships no logo wall and no customer counts, so this band
 * does not pretend to have either. What it does have is the author's trust line
 * — a concrete statement about roles, row-level isolation and expiring URLs —
 * and that is what earns the slot. A row of invented logos would be worth less
 * than one true sentence.
 *
 * Optional slots (a lead-in, named marks, counted proof points, a pull quote)
 * are all still supported, so the strip fills out on its own the day the
 * content gains them.
 *
 * Ground is `bg-muted/40`: the first ground change on the page, so the eye
 * registers a new band rather than more hero.
 */

import { Quote, ShieldCheck } from "lucide-react";

import { Counter, Reveal, stagger } from "@/components/landing/primitives";
import { pick, pickList, str, trust } from "@/components/landing/content";

function proofPoints(source) {
  return pickList(source, "stats", "metrics", "items", "points", "proof")
    .map((entry) => {
      if (typeof entry === "string") return null;
      const value = str(entry?.value ?? entry?.stat ?? entry?.number);
      const label = str(entry?.label ?? entry?.title ?? entry?.text);
      return value && label ? { value, label } : null;
    })
    .filter(Boolean);
}

function marks(source) {
  return pickList(source, "logos", "brands", "customers", "marks", "badges")
    .map((entry) => (typeof entry === "string" ? str(entry) : pick(entry, "name", "label", "title")))
    .filter(Boolean);
}

export default function TrustStrip() {
  if (!trust) return null;

  const section = Array.isArray(trust) ? { items: trust } : trust;

  const lead = pick(section, "eyebrow", "label", "kicker");
  const line = pick(section, "line", "trustLine", "statement", "description", "intro", "title");
  const points = proofPoints(section);
  const names = marks(section);
  const quoteText = pick(section, "quote", "testimonial");
  const quoteAttribution = pick(section, "attribution", "author", "byline", "cite", "source");

  if (!line && points.length === 0 && names.length === 0 && !quoteText) return null;

  // No heading of its own, and none invented for it: an unnamed <section> is
  // simply not exposed as a landmark, which is the correct outcome here.
  return (
    <section className="relative isolate overflow-hidden border-y border-border bg-muted/40 py-14 sm:py-16">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        {lead ? (
          <Reveal>
            <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {lead}
            </p>
          </Reveal>
        ) : null}

        {points.length > 0 ? (
          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 text-center sm:gap-x-10 lg:grid-cols-4">
            {points.slice(0, 4).map((point, index) => (
              <Reveal key={point.label} delay={stagger(index)}>
                <dt className="sr-only">{point.label}</dt>
                <dd>
                  <span className="block font-display text-4xl font-semibold tracking-[-0.03em] text-foreground sm:text-5xl">
                    <Counter value={point.value} />
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                    {point.label}
                  </span>
                </dd>
              </Reveal>
            ))}
          </dl>
        ) : null}

        {line ? (
          <Reveal delay={stagger(2)}>
            <div className="mx-auto mt-12 flex max-w-4xl flex-col items-center gap-5 border-t border-border pt-10 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/10 text-success"
              >
                <ShieldCheck className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <p className="text-base leading-relaxed text-foreground sm:text-lg">{line}</p>
            </div>
          </Reveal>
        ) : null}

        {names.length > 0 ? (
          <ul
            className={[
              "flex flex-wrap items-center justify-center gap-x-8 gap-y-4 sm:gap-x-12",
              line || lead ? "mt-12" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {names.map((name, index) => (
              <Reveal as="li" key={name} delay={stagger(index)}>
                <span className="font-display text-base font-semibold tracking-[-0.01em] text-muted-foreground sm:text-lg">
                  {name}
                </span>
              </Reveal>
            ))}
          </ul>
        ) : null}

        {quoteText ? (
          <Reveal delay={stagger(1)}>
            <figure className="mx-auto mt-14 max-w-3xl text-center">
              <Quote className="mx-auto h-6 w-6 text-primary/40" aria-hidden="true" />
              <blockquote className="mt-4 text-xl font-medium leading-relaxed tracking-[-0.01em] text-foreground [text-wrap:balance] sm:text-2xl">
                {quoteText}
              </blockquote>
              {quoteAttribution ? (
                <figcaption className="mt-5 text-sm text-muted-foreground">
                  {quoteAttribution}
                </figcaption>
              ) : null}
            </figure>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
