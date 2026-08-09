"use client";

/**
 * FAQ.
 *
 * Native `<details>` / `<summary>` rather than a hand-rolled disclosure: the
 * keyboard behaviour, the `aria-expanded` state and the in-page-find expansion
 * all come from the platform, and the answers are readable with JavaScript
 * turned off.
 *
 * The only animated part is the chevron, which rotates — a transform. The panel
 * itself does not animate: height and grid-row animations are layout
 * animations, and this page does not do those.
 */

import { ChevronDown } from "lucide-react";

import { Reveal, SectionHeading, stagger } from "@/components/landing/primitives";
import { faq, heading, items, pick } from "@/components/landing/content";

function questionList() {
  return items(faq, "items", "questions", "list", "faqs")
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = pick(entry, "question", "q", "title", "heading");
      const answer = pick(entry, "answer", "a", "body", "description", "text", "copy");
      return question && answer ? { question, answer } : null;
    })
    .filter(Boolean);
}

export default function Faq() {
  const questions = questionList();
  const { eyebrow, title, description } = heading(faq);

  if (questions.length === 0) return null;

  return (
    <section
      id="faq"
      aria-labelledby={title ? "faq-heading" : undefined}
      className="relative isolate scroll-mt-20 overflow-hidden border-t border-border bg-muted/40 py-20 sm:py-24 lg:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          headingId={title ? "faq-heading" : undefined}
          align="center"
        />

        <div className="mx-auto mt-14 max-w-3xl sm:mt-16">
          <ul className="space-y-3">
            {questions.map((entry, index) => (
              <Reveal as="li" key={entry.question} delay={stagger(index)}>
                <details className="group rounded-2xl border border-border bg-card px-5 shadow-card transition-colors duration-300 ease-out open:border-primary/20 sm:px-6">
                  <summary
                    className="flex cursor-pointer list-none items-start justify-between gap-4 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden"
                  >
                    <h3 className="text-base font-semibold leading-snug tracking-[-0.01em] text-foreground sm:text-lg">
                      {entry.question}
                    </h3>
                    <ChevronDown
                      className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="pb-5 pr-9">
                    <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {entry.answer}
                    </p>
                  </div>
                </details>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
