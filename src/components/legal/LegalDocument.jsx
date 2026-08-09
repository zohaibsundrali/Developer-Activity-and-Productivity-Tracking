/**
 * Renderer for the long-form legal documents in src/content/legal/.
 *
 * The content modules are plain data — arrays of sections, each holding typed
 * blocks. Nothing in them knows about React, so the same privacy policy can be
 * rendered here, exported to PDF later, or read by a lawyer as a diff without
 * wading through markup.
 *
 * READING ERGONOMICS, deliberately:
 *   - The prose column is capped at 68 characters. Anything wider and the eye
 *     loses the start of the next line, which is exactly how a policy stops
 *     being read at section four.
 *   - Real heading hierarchy: one h1, one h2 per section, h3 for subheadings.
 *     A screen-reader user can jump the document by heading.
 *   - The table of contents is plain anchor links, so it works with JavaScript
 *     off and every entry is a real, focusable destination.
 *   - Tables scroll inside their own container; the page body never scrolls
 *     sideways on a phone.
 *
 * Token-only styling, matching the rest of the app: no hex, no bg-white, no
 * text-gray-*. This is a server component — nothing here needs the client.
 */

import Link from "next/link";

/* ── Blocks ──────────────────────────────────────────────────────── */

const TONES = {
  plain: "border-border bg-muted/60 text-foreground",
  info: "border-info/30 bg-info/5 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  critical: "border-destructive/40 bg-destructive/5 text-foreground",
};

const TONE_TITLES = {
  plain: "text-foreground",
  info: "text-info",
  warning: "text-warning-foreground",
  critical: "text-destructive",
};

function Block({ block }) {
  if (!block || typeof block !== "object") return null;

  switch (block.type) {
    case "paragraph":
      return <p className="mt-4 text-[0.975rem] leading-7 text-muted-foreground">{block.text}</p>;

    case "subheading":
      return (
        <h3 className="mt-8 font-display text-lg font-semibold tracking-tight text-foreground">
          {block.text}
        </h3>
      );

    case "list": {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) return null;
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          className={`mt-4 space-y-2 ps-5 text-[0.975rem] leading-7 text-muted-foreground ${
            block.ordered ? "list-decimal" : "list-disc"
          } marker:text-primary/70`}
        >
          {items.map((item, i) => (
            <li key={i} className="ps-1">
              {item}
            </li>
          ))}
        </ListTag>
      );
    }

    case "definitions": {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) return null;
      return (
        <dl className="mt-5 space-y-4">
          {items.map((item, i) => (
            <div key={i} className="border-s-2 border-border ps-4">
              <dt className="text-sm font-semibold text-foreground">{item.term}</dt>
              <dd className="mt-1 text-[0.95rem] leading-7 text-muted-foreground">{item.text}</dd>
            </div>
          ))}
        </dl>
      );
    }

    case "table": {
      const columns = Array.isArray(block.columns) ? block.columns : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (columns.length === 0 || rows.length === 0) return null;
      return (
        <figure className="mt-6">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[34rem] border-collapse text-start text-sm">
              <thead className="bg-muted">
                <tr>
                  {columns.map((column, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="border-b border-border px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r} className="align-top even:bg-muted/40">
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={`border-b border-border px-4 py-3 leading-6 ${
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
          {block.caption ? (
            <figcaption className="mt-2 text-xs leading-6 text-muted-foreground">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    }

    case "callout": {
      const tone = TONES[block.tone] ? block.tone : "plain";
      return (
        <aside className={`mt-6 rounded-xl border p-5 ${TONES[tone]}`}>
          {block.title ? (
            <p className={`font-display text-sm font-semibold tracking-tight ${TONE_TITLES[tone]}`}>
              {block.title}
            </p>
          ) : null}
          <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">{block.text}</p>
        </aside>
      );
    }

    default:
      return null;
  }
}

function Blocks({ blocks }) {
  const list = Array.isArray(blocks) ? blocks : [];
  return list.map((block, i) => <Block key={i} block={block} />);
}

/* ── Document ────────────────────────────────────────────────────── */

/**
 * An appended document — used for the employee monitoring notice, which the DPA
 * refers to as an annex and which a customer is meant to detach, fill in and
 * hand to their own staff. It renders as a bounded card rather than as more
 * numbered sections, because the voice changes completely: the document above
 * addresses a controller, the annex addresses the person being monitored.
 *
 * Heading level stays correct — the annex title is an h2 alongside the numbered
 * sections, and its own sections drop to h3.
 */
function Annex({ annex }) {
  if (!annex) return null;
  const sections = Array.isArray(annex.sections) ? annex.sections : [];

  return (
    <section id="annex-employee-notice" className="scroll-mt-8 pt-12">
      <div className="rounded-2xl border border-primary/25 bg-accent/40 p-6 sm:p-8">
        {annex.kicker ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {annex.kicker}
          </p>
        ) : null}
        <h2 className="mt-3 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {annex.title}
        </h2>
        {annex.subtitle ? (
          <p className="mt-3 text-[0.975rem] leading-7 text-muted-foreground">{annex.subtitle}</p>
        ) : null}

        <Blocks blocks={annex.intro} />

        {sections.map((section) => (
          <section key={section.id} id={`annex-${section.id}`} className="scroll-mt-8 pt-8">
            <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
              {section.heading}
            </h3>
            <Blocks blocks={section.blocks} />
          </section>
        ))}

        {Array.isArray(annex.openItems) && annex.openItems.length > 0 ? (
          <div className="mt-10 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
            <p className="font-display text-sm font-semibold tracking-tight text-destructive">
              Before you hand this to anyone
            </p>
            <ul className="mt-3 space-y-3">
              {annex.openItems.map((item, i) => (
                <li key={i}>
                  <p className="text-[0.95rem] font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-[0.95rem] leading-7 text-muted-foreground">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.document a module from src/content/legal/
 * @param {Object} [props.annex]  a second document appended as an annex
 * @param {string} [props.annexLabel] table-of-contents label for the annex
 * @param {string} [props.backHref]
 * @param {string} [props.backLabel]
 */
export default function LegalDocument({
  document,
  annex = null,
  annexLabel = "Annex",
  related = [],
  backHref = "/",
  backLabel = "Back to Verisade",
}) {
  if (!document) return null;

  const sections = Array.isArray(document.sections) ? document.sections : [];
  const openItems = Array.isArray(document.openItems) ? document.openItems : [];

  return (
    <main className="bg-background pb-24">
      {/* Masthead */}
      <header className="border-b border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 pb-12 pt-10 sm:pt-14">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span aria-hidden="true">&larr;</span>
            {backLabel}
          </Link>

          <div className="mt-6 max-w-[68ch]">
            {document.kicker ? (
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                {document.kicker}
              </p>
            ) : null}
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {document.title}
            </h1>
            {document.subtitle ? (
              <p className="mt-4 text-lg leading-8 text-muted-foreground">{document.subtitle}</p>
            ) : null}

            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              {document.lastUpdated ? (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Last updated</dt>
                  <dd className="font-medium tabular-nums text-foreground">
                    {document.lastUpdated}
                  </dd>
                </div>
              ) : null}
              {document.appliesTo ? (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Applies to</dt>
                  <dd className="font-medium text-foreground">{document.appliesTo}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6">
        {/* Review notice — first thing after the masthead, on purpose. */}
        {document.reviewNotice ? (
          <div className="mt-10 max-w-[68ch] rounded-xl border border-warning/40 bg-warning/10 p-5">
            <p className="font-display text-sm font-semibold tracking-tight text-warning-foreground">
              {document.reviewNotice.title}
            </p>
            <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">
              {document.reviewNotice.text}
            </p>
          </div>
        ) : null}

        <div className="lg:flex lg:gap-14">
          {/* Table of contents */}
          <nav
            aria-labelledby="toc-heading"
            className="mt-12 lg:sticky lg:top-8 lg:mt-16 lg:h-fit lg:w-64 lg:shrink-0"
          >
            <h2
              id="toc-heading"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              On this page
            </h2>
            <ol className="mt-4 space-y-2.5 border-s border-border ps-4 text-sm">
              {sections.map((section, i) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex gap-2 rounded text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="tabular-nums text-muted-foreground/60">{i + 1}.</span>
                    <span>{section.heading}</span>
                  </a>
                </li>
              ))}
              {openItems.length > 0 ? (
                <li>
                  <a
                    href="#open-items"
                    className="inline-flex gap-2 rounded font-medium text-destructive transition-colors hover:text-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="tabular-nums opacity-60">{sections.length + 1}.</span>
                    <span>Open items</span>
                  </a>
                </li>
              ) : null}
              {annex ? (
                <li>
                  <a
                    href="#annex-employee-notice"
                    className="inline-flex gap-2 rounded text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="tabular-nums text-muted-foreground/60">
                      {sections.length + (openItems.length > 0 ? 2 : 1)}.
                    </span>
                    <span>{annexLabel}</span>
                  </a>
                </li>
              ) : null}
            </ol>
          </nav>

          {/* Body */}
          <article className="mt-12 min-w-0 max-w-[68ch] lg:mt-16">
            {document.intro ? (
              <div className="border-b border-border pb-10">
                <Blocks blocks={document.intro} />
              </div>
            ) : null}

            {sections.map((section, i) => (
              <section key={section.id} id={section.id} className="scroll-mt-8 pt-12">
                <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  <span className="me-2 tabular-nums font-normal text-muted-foreground/60">
                    {i + 1}.
                  </span>
                  {section.heading}
                </h2>
                <Blocks blocks={section.blocks} />
              </section>
            ))}

            {openItems.length > 0 ? (
              <section id="open-items" className="scroll-mt-8 pt-12">
                <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  <span className="me-2 tabular-nums font-normal text-muted-foreground/60">
                    {sections.length + 1}.
                  </span>
                  Open items — resolve before relying on this document
                </h2>
                <p className="mt-4 text-[0.975rem] leading-7 text-muted-foreground">
                  Each item below is a decision that cannot be read out of the source code. They are
                  listed here, in the published document, rather than hidden in a comment — an
                  unfinished policy should look unfinished.
                </p>
                <ol className="mt-6 space-y-5">
                  {openItems.map((item, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
                    >
                      <p className="font-display text-sm font-semibold tracking-tight text-destructive">
                        {item.title}
                      </p>
                      <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">
                        {item.text}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <Annex annex={annex} />

            {related.length > 0 ? (
              <nav
                aria-label="Related documents"
                className="mt-16 border-t border-border pt-8"
              >
                <p className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  The rest of the paperwork
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {related.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {link.label}
                      </Link>
                      {link.note ? (
                        <span className="text-muted-foreground"> — {link.note}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </article>
        </div>
      </div>
    </main>
  );
}
