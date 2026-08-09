"use client";

/**
 * Feature grid.
 *
 * The content module ships `features` as a bare array with no section title, so
 * this section has no heading — and none is invented for it. That has a
 * knock-on: with no `<h2>` of its own, the card titles *are* the second level,
 * so they render as `<h2>` rather than `<h3>` and the document outline stays
 * legal. The moment the content grows a title, the cards demote themselves to
 * `<h3>` automatically.
 *
 * Layout is a plain three-up grid with the lead card widened on `lg`, so the
 * eye has an entry point instead of a uniform table. The span is decided by
 * index here, not authored in the content, so reordering the copy cannot break
 * the layout.
 *
 * Cards reveal row-major at 80ms apart and lift 4px on hover. The lift is
 * `motion-safe:` gated: under reduced motion the card still gets its shadow and
 * border-colour feedback, it just never moves.
 */

import {
  CARD_LIFT,
  Container,
  Eyebrow,
  IconChip,
  Reveal,
  SectionHeading,
  stagger,
} from "@/components/landing/primitives";
import { bullets, features, heading, items, pick, str } from "@/components/landing/content";

function featureCards() {
  return items(features, "items", "list", "cards", "features")
    .map((entry) => {
      if (typeof entry === "string") {
        const text = str(entry);
        return text ? { title: text, description: null, icon: null, role: null, points: [] } : null;
      }
      const title = pick(entry, "title", "name", "heading", "label");
      if (!title) return null;
      return {
        title,
        description: pick(entry, "description", "body", "copy", "text", "detail"),
        icon: entry.icon ?? entry.iconName ?? null,
        // Who the feature is for, when the author says so.
        role: pick(entry, "role", "audience", "for", "persona"),
        points: bullets(entry, "points", "bullets", "highlights", "list"),
      };
    })
    .filter(Boolean);
}

export default function Features() {
  const cards = featureCards();
  const { eyebrow, title, description } = heading(features);

  if (cards.length === 0) return null;

  const hasHeader = Boolean(eyebrow || title || description);
  // Widening the lead card costs an extra cell, so only do it when the total
  // still divides into complete rows of three — otherwise the grid ends on a
  // single orphaned card.
  const widenLead = cards.length > 3 && (cards.length + 1) % 3 === 0;
  const CardHeading = title ? "h3" : "h2";

  return (
    <section
      id="features"
      aria-labelledby={title ? "features-heading" : undefined}
      className="relative isolate scroll-mt-20 overflow-hidden border-t border-border bg-muted/40 py-20 sm:py-24 lg:py-32"
    >
      <Container>
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          headingId={title ? "features-heading" : undefined}
          align="center"
        />

        <ul
          className={[
            "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3",
            hasHeader ? "mt-16 sm:mt-20" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {cards.map((card, index) => (
            <Reveal
              as="li"
              key={card.title}
              delay={stagger(index)}
              className={[index === 0 && widenLead ? "lg:col-span-2" : "", "h-full"]
                .filter(Boolean)
                .join(" ")}
            >
              <article
                className={[
                  "flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7",
                  CARD_LIFT,
                ].join(" ")}
              >
                <IconChip icon={card.icon} />

                <CardHeading
                  className={[
                    "font-display text-lg font-semibold leading-snug tracking-[-0.015em] text-foreground sm:text-xl",
                    card.icon ? "mt-5" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {card.title}
                </CardHeading>

                {card.description ? (
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
                    {card.description}
                  </p>
                ) : (
                  <span className="flex-1" />
                )}

                {card.points.length > 0 ? (
                  <ul className="mt-6 space-y-2.5 border-t border-border pt-6">
                    {card.points.map((point) => (
                      <li key={point.text} className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        />
                        <span className="text-sm leading-relaxed text-foreground">{point.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {card.role ? (
                  <div className="mt-6 border-t border-border pt-5">
                    <Eyebrow>{card.role}</Eyebrow>
                  </div>
                ) : null}
              </article>
            </Reveal>
          ))}
        </ul>
      </Container>
    </section>
  );
}
