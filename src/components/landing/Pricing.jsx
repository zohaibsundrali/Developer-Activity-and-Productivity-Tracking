"use client";

/**
 * Pricing.
 *
 * Four cards on `xl`, two from `sm`, one on a phone. The plan the content marks
 * (`highlight` / `featured` / `popular`) gets the heavier border and the only
 * filled button in the section, so "one primary CTA per section" survives
 * having four buttons on screen.
 *
 * `priceLabel` is preferred over `price` because the author already formatted
 * it — reading the raw `price: 0` would put a bare "0" on the Free card.
 *
 * The plan limits are the page's counters: real numbers from the seeded billing
 * plans, counting up as each card reveals. Non-numeric limits ("Unlimited")
 * fall through the counter untouched, because it only animates when it can find
 * a number.
 */

import { Calculator, Check, Minus } from "lucide-react";

import {
  CARD_LIFT,
  Container,
  Counter,
  CtaButton,
  Reveal,
  SectionHeading,
  stagger,
} from "@/components/landing/primitives";
import { bullets, cta, heading, items, pick, pickList, pricing, str } from "@/components/landing/content";

/** `[{label,value}]` — the seeded plan limits. */
function planLimits(entry) {
  return pickList(entry, "limits", "quotas", "caps")
    .map((limit) => {
      if (typeof limit === "string") return null;
      const label = pick(limit, "label", "name", "title");
      const value = str(limit?.value ?? limit?.amount ?? limit?.count);
      return label && value ? { label, value } : null;
    })
    .filter(Boolean);
}

function planList() {
  const plans = items(pricing, "plans", "tiers", "items", "list")
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const name = pick(entry, "name", "title", "plan", "tier");
      if (!name) return null;
      return {
        key: pick(entry, "code", "id") ?? name,
        name,
        // Author-formatted label first; the raw number is the last resort.
        price: pick(entry, "priceLabel", "displayPrice", "price", "amount", "cost"),
        period: pick(entry, "period", "interval", "cadence", "per", "unit"),
        description: pick(entry, "description", "body", "copy", "text", "tagline"),
        limits: planLimits(entry),
        includes: bullets(entry, "includes", "features", "bullets", "points"),
        excludes: bullets(entry, "excludes", "notIncluded", "missing"),
        action: cta(entry.cta ?? entry.primaryCta ?? entry.action ?? entry.link),
        note: pick(entry, "note", "footnote", "smallprint"),
        featured: Boolean(entry.highlight ?? entry.featured ?? entry.popular ?? entry.recommended),
        badge: pick(entry, "badge", "ribbon", "tagLabel"),
      };
    })
    .filter(Boolean);

  // Nothing marked? Give the emphasis to the first card so the eye has an entry
  // point — but never render a "most popular" claim the content did not make.
  if (plans.length > 0 && !plans.some((plan) => plan.featured)) plans[0].featured = true;

  return plans;
}

export default function Pricing() {
  const plans = planList();
  const { eyebrow, title, description } = heading(pricing);
  const footnote = pick(pricing, "footnote", "disclaimer", "smallprint");
  const note = pick(pricing, "note");
  // The arithmetic, stated once, next to the table it is about.
  const comparison = pick(pricing, "comparison", "versus", "seatMath");

  if (plans.length === 0 && !title) return null;

  /*
    Four across only once the measure can actually pay for it.

    On the 1400px container `xl` gives each of four cards ~323px, which is the
    first width at which the two-column limits list holds "Unlimited" on one
    line and the plan button holds its label without wrapping. Below that the
    row collapses to two — 1024px over four cards left ~229px each, and the
    limits grid was folding inside it. Two roomy cards beat four cramped ones.
  */
  const columns =
    plans.length >= 4
      ? "sm:grid-cols-2 xl:grid-cols-4"
      : plans.length === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : plans.length === 2
          ? "sm:grid-cols-2"
          : "";

  return (
    <section
      id="pricing"
      aria-labelledby={title ? "pricing-heading" : undefined}
      className="relative isolate scroll-mt-20 overflow-hidden border-t border-border bg-background py-20 sm:py-24 lg:py-32"
    >
      <Container>
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          headingId={title ? "pricing-heading" : undefined}
          align="center"
        />

        {plans.length > 0 ? (
          <ul
            className={[
              // `max-w-md` caps the single-column phone layout only; from `sm`
              // up the row takes the full container.
              "mx-auto mt-16 grid max-w-md grid-cols-1 items-stretch gap-5 sm:mt-20 sm:max-w-none xl:gap-6",
              columns,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {plans.map((plan, index) => (
              <Reveal as="li" key={plan.key} delay={stagger(index)} className="h-full">
                <article
                  className={[
                    "relative flex h-full flex-col rounded-2xl bg-card p-6 sm:p-7",
                    CARD_LIFT,
                    plan.featured
                      ? "border-2 border-primary shadow-elevated"
                      : "border border-border shadow-card",
                  ].join(" ")}
                >
                  {plan.featured && plan.badge ? (
                    <span className="absolute -top-3 left-6 inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground">
                      {plan.badge}
                    </span>
                  ) : null}

                  <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
                    {plan.name}
                  </h3>

                  {plan.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {plan.description}
                    </p>
                  ) : null}

                  {plan.price ? (
                    <p className="mt-6 flex items-baseline gap-1">
                      <span className="font-display text-4xl font-semibold tracking-[-0.03em] text-foreground">
                        {plan.price}
                      </span>
                      {plan.period ? (
                        <span className="text-sm text-muted-foreground">
                          <span aria-hidden="true">/</span>
                          <span className="sr-only"> per </span>
                          {plan.period}
                        </span>
                      ) : null}
                    </p>
                  ) : null}

                  {plan.limits.length > 0 ? (
                    <dl className="mt-7 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-6 xl:gap-x-6">
                      {plan.limits.map((limit) => (
                        <div key={limit.label}>
                          <dd className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                            <Counter value={limit.value} />
                          </dd>
                          <dt className="mt-0.5 text-xs text-muted-foreground">{limit.label}</dt>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {plan.includes.length > 0 ? (
                    <ul className="mt-6 flex-1 space-y-3 border-t border-border pt-6">
                      {plan.includes.map((feature) => (
                        <li key={feature.text} className="flex items-start gap-2.5">
                          <Check
                            className="mt-0.5 h-4 w-4 shrink-0 text-success"
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                          <span className="text-sm leading-relaxed text-foreground">
                            {feature.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="flex-1" />
                  )}

                  {plan.excludes.length > 0 ? (
                    <ul className="mt-4 space-y-2.5">
                      {plan.excludes.map((feature) => (
                        <li key={feature.text} className="flex items-start gap-2.5">
                          <Minus
                            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                          <span className="text-sm leading-relaxed text-muted-foreground line-through decoration-border">
                            {feature.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {plan.action ? (
                    <CtaButton
                      href={plan.action.href}
                      variant={plan.featured ? "primary" : "secondary"}
                      size="md"
                      className="mt-7 w-full px-4 text-center leading-tight"
                    >
                      {plan.action.label}
                    </CtaButton>
                  ) : null}

                  {plan.note ? (
                    <p className="mt-4 text-xs text-muted-foreground">{plan.note}</p>
                  ) : null}
                </article>
              </Reveal>
            ))}
          </ul>
        ) : null}

        {comparison ? (
          <Reveal delay={stagger(1)}>
            {/* One step wider than the prose cap, not the full container: the
                icon and its gap eat ~64px, so `max-w-4xl` leaves the sentence
                itself at a readable measure while giving it room to stop
                wrapping onto three ragged lines. */}
            <div className="mx-auto mt-12 flex max-w-4xl flex-col items-center gap-4 rounded-2xl border border-primary/20 bg-accent p-6 text-center sm:flex-row sm:items-center sm:gap-5 sm:p-7 sm:text-left">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              >
                <Calculator className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <p className="text-sm leading-relaxed text-accent-foreground sm:text-base">
                {comparison}
              </p>
            </div>
          </Reveal>
        ) : null}

        {footnote || note ? (
          <Reveal delay={stagger(2)}>
            <div className="mx-auto mt-10 max-w-2xl space-y-2 text-center">
              {footnote ? (
                <p className="text-sm leading-relaxed text-foreground">{footnote}</p>
              ) : null}
              {note ? <p className="text-sm leading-relaxed text-muted-foreground">{note}</p> : null}
            </div>
          </Reveal>
        ) : null}
      </Container>
    </section>
  );
}
