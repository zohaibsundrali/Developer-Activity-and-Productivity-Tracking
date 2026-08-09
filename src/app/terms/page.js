/**
 * Terms of Service page.
 *
 * A server component with no client JavaScript at all: long-form legal text
 * that fails to render because a bundle did not load is worse than useless, so
 * every affordance here is HTML the browser already knows — anchor links for
 * the table of contents, `<details>` for the outstanding-items list.
 *
 * This file renders; it does not author. Every word comes from
 * src/content/legal/terms.js, so a clause can never be edited in one place and
 * left stale in another.
 *
 * Layout: a sticky table of contents on large screens, and an article held to a
 * ~68ch measure — the width at which a reader's eye reliably finds the start of
 * the next line. Tables are the one thing allowed past that measure, and they
 * scroll inside their own container rather than widening the page.
 *
 * Tokens only — no hex, no `text-gray-*` — so the page follows the app's
 * palette in both themes.
 */

import Link from "next/link";
import Logo from "@/components/brand/Logo";

import terms, { meta, lawyerNotice, keyPoint, placeholders, sections } from "@/content/legal/terms";

export function generateMetadata() {
  return {
    title: meta.title,
    description:
      "The terms that govern use of Verisade, including your responsibilities when you use it to monitor the people who work for you.",
  };
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

const CALLOUT_TONES = {
  critical: {
    wrapper: "border-l-4 border-destructive bg-destructive/5",
    title: "text-destructive",
    marker: "marker:text-destructive",
  },
  warning: {
    wrapper: "border-l-4 border-warning bg-warning/10",
    // Deliberately `text-foreground` rather than `text-warning-foreground`:
    // that token is a near-black meant to sit ON a solid warning fill, and it
    // loses its contrast on a 10% tint of the same colour in dark mode.
    title: "text-foreground",
    marker: "marker:text-warning",
  },
  note: {
    wrapper: "border-l-4 border-primary/40 bg-accent",
    title: "text-accent-foreground",
    marker: "marker:text-primary",
  },
};

function Callout({ block }) {
  const tone = CALLOUT_TONES[block.tone] || CALLOUT_TONES.note;
  return (
    <aside className={`my-7 rounded-r-lg px-5 py-4 sm:px-6 sm:py-5 ${tone.wrapper}`}>
      {block.title ? (
        <p className={`mb-2 font-display text-base font-semibold ${tone.title}`}>{block.title}</p>
      ) : null}
      <ul className={`space-y-2.5 ${block.items.length > 1 ? "list-disc pl-5" : ""} ${tone.marker}`}>
        {block.items.map((item, i) => (
          <li key={i} className="text-[0.975rem] leading-7 text-foreground/90">
            {item}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Table({ block }) {
  return (
    <figure className="my-7">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-sm">
          {block.caption ? (
            <caption className="border-b border-border bg-muted px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {block.caption}
            </caption>
          ) : null}
          <thead>
            <tr className="bg-secondary">
              {block.head.map((cell, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-b border-border px-4 py-3 font-display text-xs font-semibold uppercase tracking-wide text-secondary-foreground"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="border-b border-border last:border-b-0">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`px-4 py-3 align-top leading-6 ${
                      c === 0 ? "font-medium text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Block({ block }) {
  switch (block.type) {
    case "p":
      return <p className="my-5 leading-8 text-foreground/90">{block.text}</p>;

    case "h3":
      return (
        <h3 className="mt-9 mb-3 font-display text-lg font-semibold tracking-tight text-foreground">
          {block.text}
        </h3>
      );

    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List
          className={`my-5 space-y-3 pl-6 ${
            block.ordered ? "list-decimal marker:font-semibold" : "list-disc"
          } marker:text-primary`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="leading-8 text-foreground/90">
              {item}
            </li>
          ))}
        </List>
      );
    }

    case "definitions":
      return (
        <dl className="my-6 divide-y divide-border rounded-lg border border-border bg-card">
          {block.items.map((item, i) => (
            <div key={i} className="px-5 py-4 sm:px-6">
              <dt className="font-display text-base font-semibold text-foreground">{item.term}</dt>
              <dd className="mt-1.5 leading-7 text-muted-foreground">{item.definition}</dd>
            </div>
          ))}
        </dl>
      );

    case "callout":
      return <Callout block={block} />;

    case "table":
      return <Table block={block} />;

    case "ref":
      return (
        <p className="my-5 flex flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/60 px-5 py-4">
          <span className="font-display text-sm font-semibold text-foreground">{block.label}</span>
          <span className="text-sm leading-6 text-muted-foreground">{block.note}</span>
        </p>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Section({ section }) {
  const critical = section.emphasis === "critical";

  return (
    <section
      id={section.id}
      // Sections are scroll targets; the offset keeps a heading clear of the
      // sticky header instead of hiding it underneath.
      className={`scroll-mt-24 border-t border-border pt-10 first:border-t-0 first:pt-0 ${
        critical ? "sm:-mx-6 sm:rounded-xl sm:bg-destructive/[0.03] sm:px-6 sm:pb-8" : ""
      }`}
    >
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]">
        <span className={`mr-3 tabular-nums ${critical ? "text-destructive" : "text-primary"}`}>
          {section.number}.
        </span>
        {section.title}
      </h2>

      {section.lede ? (
        <p className="mt-4 border-l-4 border-destructive/60 pl-5 text-[1.05rem] font-medium leading-8 text-foreground">
          {section.lede}
        </p>
      ) : null}

      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}

      <p className="mt-8">
        <a
          href="#contents"
          className="rounded text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to contents
        </a>
      </p>
    </section>
  );
}

export default function TermsPage() {
  const doc = terms;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#document"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to the terms
      </a>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Logo variant="full" className="text-base" />
          </Link>
          <Link
            href="/"
            className="rounded text-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6 lg:px-8">
        {/* Title block */}
        <div className="max-w-[68ch] pt-12 sm:pt-16">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            {meta.productName}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {meta.title}
          </h1>
          <dl className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <div className="flex gap-1.5">
              <dt className="font-medium text-foreground">Last updated</dt>
              <dd>
                <time dateTime={meta.lastUpdated}>{meta.lastUpdatedLabel}</time>
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-medium text-foreground">Effective</dt>
              <dd>{meta.effectiveDate}</dd>
            </div>
            <div>{meta.readingTime}</div>
          </dl>
          <p className="mt-6 text-[1.05rem] leading-8 text-foreground/90">{meta.intro}</p>
        </div>

        {/* The one thing a reader must not miss */}
        <div className="mt-10 max-w-[68ch] rounded-xl border-l-4 border-destructive bg-destructive/5 px-6 py-6 sm:px-7">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-destructive">
            {keyPoint.eyebrow}
          </p>
          <p className="mt-2 font-display text-xl font-bold leading-8 tracking-tight text-foreground">
            {keyPoint.title}
          </p>
          <p className="mt-3 leading-8 text-foreground/90">{keyPoint.body}</p>
          <a
            href={`#${keyPoint.linkToSection}`}
            className="mt-4 inline-flex rounded font-medium text-destructive underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {keyPoint.linkLabel}
          </a>
        </div>

        {/* Honest framing: this is a draft, and here is what is missing */}
        <div className="mt-6 max-w-[68ch] rounded-xl border border-border bg-card px-6 py-6 sm:px-7">
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {lawyerNotice.title}
          </h2>
          {lawyerNotice.body.map((line, i) => (
            <p key={i} className="mt-3 leading-7 text-muted-foreground">
              {line}
            </p>
          ))}

          {placeholders.length > 0 ? (
            <details className="group mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer list-none rounded font-display text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="group-open:hidden">
                  Show the {placeholders.length} details still to be filled in
                </span>
                <span className="hidden group-open:inline">Hide outstanding details</span>
              </summary>
              <ul className="mt-4 space-y-3">
                {placeholders.map((item) => (
                  <li key={item.token} className="text-sm leading-6">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8rem] text-foreground">
                      {item.token}
                    </code>
                    <span className="ml-2 text-muted-foreground">
                      {item.where} — {item.note}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {/* Contents + document */}
        <div className="mt-14 gap-12 lg:flex lg:items-start">
          <nav
            id="contents"
            aria-labelledby="contents-heading"
            className="scroll-mt-24 lg:sticky lg:top-24 lg:w-64 lg:shrink-0"
          >
            <h2
              id="contents-heading"
              className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Contents
            </h2>
            <ol className="mt-4 space-y-2 border-l border-border">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={`-ml-px flex gap-2.5 border-l-2 py-1 pl-4 text-sm leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      section.emphasis === "critical"
                        ? "border-destructive font-semibold text-destructive hover:text-destructive"
                        : "border-transparent text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    <span className="tabular-nums">{section.number}.</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article id="document" className="mt-12 min-w-0 max-w-[68ch] lg:mt-0">
            <div className="space-y-12">
              {sections.map((section) => (
                <Section key={section.id} section={section} />
              ))}
            </div>
          </article>
        </div>
      </main>

      <footer className="border-t border-border bg-muted/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            {doc.meta.title} · Last updated{" "}
            <time dateTime={meta.lastUpdated}>{meta.lastUpdatedLabel}</time>
          </p>
          <Link
            href="/"
            className="rounded transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to {meta.productName}
          </Link>
        </div>
      </footer>
    </div>
  );
}
