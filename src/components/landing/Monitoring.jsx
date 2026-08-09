"use client";

/**
 * Monitoring disclosure.
 *
 * The hero's secondary call to action points at `#monitoring`, so this section
 * is load-bearing navigation as well as content — without it the hero links to
 * an anchor that is not on the page.
 *
 * A note on the three group labels ("Recorded", "Not recorded", "Who sees it"):
 * the content module supplies these three lists as `records`, `notRecorded` and
 * `whoSeesIt` with no headings of their own. The labels below are that same
 * taxonomy spelled for a reader — the only place on this page where a visible
 * string is not lifted verbatim from the content module. Rendering three
 * undifferentiated lists on a page about surveillance, where the difference
 * between list one and list two is the difference between "we capture this" and
 * "we do not", would be the worse call.
 *
 * The honesty note gets the warning token with dark ink on it, per the palette,
 * because that is exactly what it is: the caveat the author wanted read.
 */

import { Ban, Eye, Users } from "lucide-react";

import { CARD_LIFT, Container, Reveal, SectionHeading, stagger } from "@/components/landing/primitives";
import { monitoring, pick, pickList, str } from "@/components/landing/content";

/** Structural labels for the author's own three groups — see the note above. */
const GROUP_LABELS = {
  notRecorded: "Not recorded",
  whoSeesIt: "Who sees it",
  records: "Recorded",
};

function records() {
  return pickList(monitoring, "records", "captures", "collected")
    .map((entry) => {
      if (typeof entry === "string") {
        const text = str(entry);
        return text ? { label: text, detail: null } : null;
      }
      const label = pick(entry, "label", "title", "name");
      return label ? { label, detail: pick(entry, "detail", "description", "body", "text") } : null;
    })
    .filter(Boolean);
}

function lines(...keys) {
  return pickList(monitoring, ...keys)
    .map((entry) => (typeof entry === "string" ? str(entry) : pick(entry, "text", "label", "detail")))
    .filter(Boolean);
}

export default function Monitoring() {
  if (!monitoring) return null;

  const id = str(monitoring.id) ?? "monitoring";
  const eyebrow = pick(monitoring, "eyebrow", "kicker", "label", "tag");
  const title = pick(monitoring, "title", "heading", "headline");
  const intro = pick(monitoring, "intro", "description", "body", "subhead");
  const captured = records();
  const notRecorded = lines("notRecorded", "notCaptured", "excluded");
  const whoSeesIt = lines("whoSeesIt", "audience", "visibility");
  const honesty = pick(monitoring, "honesty", "caveat", "disclaimer", "note");

  if (!title && captured.length === 0) return null;

  return (
    <section
      id={id}
      aria-labelledby={title ? "monitoring-heading" : undefined}
      className="relative isolate scroll-mt-20 overflow-hidden border-t border-border bg-background py-20 sm:py-24 lg:py-32"
    >
      <Container>
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={intro}
          headingId={title ? "monitoring-heading" : undefined}
          align="center"
        />

        <div className="mt-16 grid grid-cols-1 gap-6 lg:mt-20 lg:grid-cols-5">
          {captured.length > 0 ? (
            <Reveal className="lg:col-span-3">
              <div
                className={[
                  "h-full rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8",
                  CARD_LIFT,
                ].join(" ")}
              >
                <h3 className="flex items-center gap-2.5 font-display text-base font-semibold tracking-[-0.01em] text-foreground">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <Eye className="h-4 w-4" strokeWidth={2} />
                  </span>
                  {GROUP_LABELS.records}
                </h3>

                <dl className="mt-6 space-y-5 border-t border-border pt-6">
                  {captured.map((entry, index) => (
                    <Reveal key={entry.label} delay={stagger(index)}>
                      <dt className="text-sm font-semibold text-foreground sm:text-base">
                        {entry.label}
                      </dt>
                      {entry.detail ? (
                        <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                          {entry.detail}
                        </dd>
                      ) : null}
                    </Reveal>
                  ))}
                </dl>
              </div>
            </Reveal>
          ) : null}

          <div className="flex flex-col gap-6 lg:col-span-2">
            {notRecorded.length > 0 ? (
              <Reveal delay={stagger(1)}>
                <div
                  className={[
                    "rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7",
                    CARD_LIFT,
                  ].join(" ")}
                >
                  <h3 className="flex items-center gap-2.5 font-display text-base font-semibold tracking-[-0.01em] text-foreground">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
                    >
                      <Ban className="h-4 w-4" strokeWidth={2} />
                    </span>
                    {GROUP_LABELS.notRecorded}
                  </h3>
                  <ul className="mt-5 space-y-3 border-t border-border pt-5">
                    {notRecorded.map((line) => (
                      <li key={line} className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/50"
                        />
                        <span className="text-sm leading-relaxed text-muted-foreground">{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ) : null}

            {whoSeesIt.length > 0 ? (
              <Reveal delay={stagger(2)}>
                <div
                  className={[
                    "rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7",
                    CARD_LIFT,
                  ].join(" ")}
                >
                  <h3 className="flex items-center gap-2.5 font-display text-base font-semibold tracking-[-0.01em] text-foreground">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success"
                    >
                      <Users className="h-4 w-4" strokeWidth={2} />
                    </span>
                    {GROUP_LABELS.whoSeesIt}
                  </h3>
                  <ul className="mt-5 space-y-3 border-t border-border pt-5">
                    {whoSeesIt.map((line) => (
                      <li key={line} className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success/50"
                        />
                        <span className="text-sm leading-relaxed text-muted-foreground">{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ) : null}
          </div>
        </div>

        {honesty ? (
          <Reveal delay={stagger(1)}>
            {/*
              The banner stays the full width of the grid above it — it is the
              caveat on that grid, and pulling it in would orphan it. The
              sentence inside does not: on the 1400px measure an uncapped
              paragraph here ran to 1352px, which is not a line anyone reads.
            */}
            <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/10 p-6 sm:p-7">
              <p className="max-w-3xl text-sm leading-relaxed text-foreground sm:text-base">
                {honesty}
              </p>
            </div>
          </Reveal>
        ) : null}
      </Container>
    </section>
  );
}
