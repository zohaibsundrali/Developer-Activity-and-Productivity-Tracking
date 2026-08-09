"use client";

/**
 * "Two halves, one permission model" — the structural claim, given its own band
 * directly under the trust strip.
 *
 * The layout *is* the argument: two equal columns, visibly separate, joined by
 * a spine that runs between them. On `lg` the spine is a vertical rule with the
 * shared-permission line centred on it; below `lg` the columns stack and the
 * spine becomes a horizontal band, because a vertical connector between two
 * stacked cards on a phone reads as a divider rather than a join.
 *
 * The connector is drawn with a bordered pseudo-free `<span>` and a badge, all
 * `aria-hidden`; the sentence it carries is real text in the flow, so the claim
 * survives with images and CSS off.
 */

import {
  CARD_LIFT,
  IconChip,
  Reveal,
  SectionHeading,
  stagger,
} from "@/components/landing/primitives";
import { extras, pick, pickList, str } from "@/components/landing/content";

const twoHalves = extras.twoHalves ?? null;

function columns() {
  return pickList(twoHalves, "columns", "halves", "items")
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const title = pick(entry, "title", "name", "heading", "label");
      if (!title) return null;
      return {
        title,
        description: pick(entry, "description", "body", "copy", "text"),
        icon: entry.icon ?? entry.iconName ?? null,
      };
    })
    .filter(Boolean);
}

export default function TwoHalves() {
  if (!twoHalves) return null;

  const id = str(twoHalves.id) ?? "one-system";
  const eyebrow = pick(twoHalves, "eyebrow", "kicker", "label", "tag");
  const title = pick(twoHalves, "title", "heading", "headline");
  const description = pick(twoHalves, "description", "subhead", "body", "intro");
  const spine = pick(twoHalves, "spine", "shared", "connector", "common");
  const footnote = pick(twoHalves, "footnote", "note", "caveat");
  const halves = columns();

  if (!title && halves.length === 0) return null;

  return (
    <section
      id={id}
      aria-labelledby={title ? "two-halves-heading" : undefined}
      className="relative isolate scroll-mt-20 overflow-hidden border-t border-border bg-background py-20 sm:py-24 lg:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          headingId={title ? "two-halves-heading" : undefined}
          align="center"
        />

        {halves.length > 0 ? (
          <div className="relative mt-16 sm:mt-20">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-16">
              {halves.slice(0, 2).map((half, index) => (
                <Reveal key={half.title} delay={stagger(index)} className="h-full">
                  <article
                    className={[
                      "flex h-full flex-col rounded-2xl border border-border bg-card p-7 shadow-card sm:p-8",
                      CARD_LIFT,
                    ].join(" ")}
                  >
                    <IconChip icon={half.icon} size="lg" />
                    <h3
                      className={[
                        "font-display text-xl font-semibold tracking-[-0.015em] text-foreground sm:text-2xl",
                        half.icon ? "mt-6" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {half.title}
                    </h3>
                    {half.description ? (
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                        {half.description}
                      </p>
                    ) : null}
                  </article>
                </Reveal>
              ))}
            </div>

            {/* The join. Vertical rule between the columns on lg, a plain band
                below it — decorative only; the sentence itself is real text. */}
            {spine ? (
              <Reveal delay={stagger(2)}>
                <div className="relative mt-6 lg:mt-10">
                  <span
                    aria-hidden="true"
                    className="absolute -top-20 left-1/2 hidden h-[calc(100%+5rem)] w-px -translate-x-1/2 bg-gradient-to-b from-border via-primary/30 to-border lg:block"
                  />
                  <p className="relative mx-auto max-w-3xl rounded-2xl border border-primary/20 bg-accent px-6 py-6 text-center text-base leading-relaxed text-accent-foreground sm:px-8 sm:text-lg">
                    {spine}
                  </p>
                </div>
              </Reveal>
            ) : null}

            {footnote ? (
              <Reveal delay={stagger(3)}>
                <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
                  {footnote}
                </p>
              </Reveal>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
