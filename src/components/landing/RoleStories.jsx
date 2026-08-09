"use client";

/**
 * Role stories — the pinned moment of the page.
 *
 * On desktop the visual column is `position: sticky` and holds still while the
 * three role narratives scroll past it. An IntersectionObserver watching a band
 * across the middle of the viewport decides which role is being read, and the
 * pinned panel cross-fades to match. Sticky positioning is pure CSS, so the pin
 * itself costs nothing on the main thread — the only JS is the observer, which
 * fires a handful of times per pass.
 *
 * Below `lg` the sticky column is dropped entirely and each story carries its
 * own visual inline: a pinned panel needs a tall viewport and a second column,
 * and a phone has neither.
 *
 * Reduced motion: the cross-fade is `motion-safe:` gated, so the panel swaps
 * instantly instead of dissolving. The pin stays — it moves nothing, it is a
 * layout, and removing it would leave a lone graphic stranded at the top of a
 * very tall column.
 *
 * The panels are abstract, `aria-hidden` compositions of tokens. They carry no
 * text of their own beyond the role name the content module supplies, so there
 * is nothing here for a reader to mistake for a real screenshot or a real
 * number.
 */

import { Check } from "lucide-react";

import {
  Container,
  CtaButton,
  Eyebrow,
  IconChip,
  ParallaxField,
  Reveal,
  SectionHeading,
  stagger,
} from "@/components/landing/primitives";
import { bullets, cta, heading, items, pick, roleSections } from "@/components/landing/content";
import { useActiveBlock, usePrefersReducedMotion } from "@/hooks/useReveal";
import { useParallax } from "@/hooks/useParallax";

/* ------------------------------------------------------------------ *
 * Abstract panels
 * ------------------------------------------------------------------ */

/** Chrome shared by all three panels: a window frame on the dark ground. */
function PanelFrame({ label, children }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar-accent shadow-popover">
      <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        {label ? (
          <span className="ml-2 truncate text-xs font-medium tracking-wide text-sidebar-muted">
            {label}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">{children}</div>
    </div>
  );
}

/** Deterministic bar heights — no `Math.random`, so SSR and client agree. */
const BAR_HEIGHTS = [38, 62, 47, 78, 55, 88, 66, 41, 72, 59, 83, 50];

function AnalyticsPanel({ label }) {
  return (
    <PanelFrame label={label}>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-sidebar-border bg-sidebar px-3 py-2.5">
            <span className="block h-1.5 w-8 rounded-full bg-sidebar-muted/40" />
            <span className="mt-2 block h-3 w-12 rounded bg-sidebar-primary/70" />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 items-end gap-1.5 rounded-lg border border-sidebar-border bg-sidebar p-3">
        {BAR_HEIGHTS.map((height, i) => (
          <span
            key={i}
            className={i % 3 === 0 ? "flex-1 rounded-t bg-primary" : "flex-1 rounded-t bg-primary/30"}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </PanelFrame>
  );
}

function WorkPanel({ label }) {
  return (
    <PanelFrame label={label}>
      <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar px-3 py-3">
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/20">
            <span className="h-2.5 w-2.5 rounded-sm bg-success" />
          </span>
          <span className="block h-2 w-24 rounded-full bg-sidebar-muted/40" />
        </span>
        <span className="block h-4 w-16 rounded bg-sidebar-primary/60" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar px-3 py-2.5"
        >
          <span
            className={[
              "h-4 w-4 shrink-0 rounded border",
              i === 0 ? "border-success bg-success/30" : "border-sidebar-border",
            ].join(" ")}
          />
          <span className="block h-2 flex-1 rounded-full bg-sidebar-muted/30" style={{ maxWidth: `${90 - i * 14}%` }} />
          <span className="block h-2 w-8 shrink-0 rounded-full bg-primary/40" />
        </div>
      ))}
    </PanelFrame>
  );
}

function TimelinePanel({ label }) {
  return (
    <PanelFrame label={label}>
      <div className="rounded-lg border border-sidebar-border bg-sidebar p-3">
        <span className="block h-2 w-20 rounded-full bg-sidebar-muted/40" />
        <div className="mt-3 space-y-2">
          {[70, 45, 88].map((width, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="block h-2 w-10 shrink-0 rounded-full bg-sidebar-muted/25" />
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sidebar-border">
                <span
                  className={i === 1 ? "block h-full rounded-full bg-warning" : "block h-full rounded-full bg-primary"}
                  style={{ width: `${width}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 rounded-lg border border-sidebar-border bg-sidebar p-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="relative flex flex-col items-center">
              <span
                className={[
                  "h-3 w-3 rounded-full",
                  i === 0 ? "bg-success" : i === 1 ? "bg-primary" : "bg-sidebar-border",
                ].join(" ")}
              />
              {i < 2 ? <span className="mt-1 h-6 w-px bg-sidebar-border" /> : null}
            </span>
            <span className="flex-1 space-y-1.5 pt-0.5">
              <span className="block h-2 rounded-full bg-sidebar-muted/35" style={{ width: `${80 - i * 18}%` }} />
              <span className="block h-2 rounded-full bg-sidebar-muted/20" style={{ width: `${55 - i * 10}%` }} />
            </span>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

const PANELS = [AnalyticsPanel, WorkPanel, TimelinePanel];

function RoleVisual({ index, label, className = "" }) {
  const Panel = PANELS[index % PANELS.length];
  return (
    <div aria-hidden="true" className={["aspect-[4/3] w-full", className].filter(Boolean).join(" ")}>
      <Panel label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Section
 * ------------------------------------------------------------------ */

function roleList() {
  return items(roleSections, "items", "roles", "list", "sections")
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const title = pick(entry, "title", "heading", "headline");
      const role = pick(entry, "role", "audience", "persona", "eyebrow", "label", "name", "for");
      if (!title && !role) return null;
      return {
        // The footer links straight at these ids, so they come from the content.
        id: pick(entry, "id", "anchor", "slug"),
        role,
        title,
        description: pick(entry, "description", "body", "copy", "text"),
        icon: entry.icon ?? entry.iconName ?? null,
        points: bullets(entry, "bullets", "points", "highlights", "features", "items"),
        action: cta(entry.cta ?? entry.primaryCta ?? entry.link),
      };
    })
    .filter(Boolean);
}

export default function RoleStories() {
  const roles = roleList();
  const { eyebrow, title, description } = heading(roleSections);
  // With no section title of its own, each role headline is the second level.
  const RoleHeading = title ? "h3" : "h2";
  const { setItemRef, activeIndex } = useActiveBlock(roles.length);
  const reduced = usePrefersReducedMotion();
  const { sectionRef, layerRef } = useParallax({ distance: 90 });

  if (roles.length === 0) return null;

  return (
    <section
      id="roles"
      ref={sectionRef}
      aria-labelledby={title ? "roles-heading" : undefined}
      // Deliberately NOT `overflow-hidden`: an ancestor with hidden overflow
      // becomes the scrollport for the sticky column below and would pin it to
      // nothing. The decorative field clips itself instead.
      className="relative isolate scroll-mt-20 border-t border-sidebar-border/50 bg-sidebar py-20 text-sidebar-foreground sm:py-24 lg:py-32"
    >
      <ParallaxField layerRef={layerRef} dark />

      <Container>
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          headingId={title ? "roles-heading" : undefined}
          align="center"
          dark
        />

        <div className="mt-16 grid grid-cols-1 gap-x-16 lg:mt-24 lg:grid-cols-2">
          {/*
            The pinned column. `self-start` is what lets `sticky` work inside a
            grid — a stretched grid item is already as tall as the row and has
            nowhere to stick.
          */}
          <div className="hidden lg:block">
            <div className="sticky top-28">
              <div className="relative aspect-[4/3] w-full">
                {roles.map((role, index) => {
                  const active = index === activeIndex;
                  // Reduced motion: render only the active panel, no opacity
                  // transition, nothing stacked behind it.
                  if (reduced && !active) return null;
                  return (
                    <div
                      key={role.title ?? role.role ?? index}
                      aria-hidden="true"
                      className={[
                        "absolute inset-0",
                        reduced
                          ? ""
                          : "transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                        active
                          ? "opacity-100"
                          : "pointer-events-none opacity-0 motion-safe:scale-[0.98]",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <RoleVisual index={index} label={role.role ?? role.title} />
                    </div>
                  );
                })}
              </div>

              {roles.length > 1 ? (
                <ol className="mt-8 flex items-center justify-center gap-2" aria-hidden="true">
                  {roles.map((role, index) => (
                    <li
                      key={role.title ?? role.role ?? index}
                      // Colour only — animating `width` would be a layout
                      // animation, which this page does not do anywhere.
                      className={[
                        "h-1.5 w-10 rounded-full transition-colors duration-500 ease-out",
                        index === activeIndex ? "bg-primary" : "bg-sidebar-border",
                      ].join(" ")}
                    />
                  ))}
                </ol>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-16 sm:gap-20 lg:gap-40">
            {roles.map((role, index) => (
              <article
                key={role.id ?? role.title ?? index}
                id={role.id ?? undefined}
                ref={setItemRef(index)}
                // Deep links from the footer land under a sticky header
                // otherwise.
                className="scroll-mt-24 lg:min-h-[24rem]"
              >
                <Reveal>
                  <div className="flex items-center gap-4">
                    <IconChip icon={role.icon} dark />
                    {role.role ? <Eyebrow dark>{role.role}</Eyebrow> : null}
                  </div>
                </Reveal>

                {role.title ? (
                  <Reveal delay={stagger(1)}>
                    <RoleHeading className="mt-5 font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-background sm:text-3xl lg:text-[2rem]">
                      {role.title}
                    </RoleHeading>
                  </Reveal>
                ) : null}

                {role.description ? (
                  <Reveal delay={stagger(2)}>
                    <p className="mt-4 text-base leading-relaxed text-sidebar-foreground sm:text-lg">
                      {role.description}
                    </p>
                  </Reveal>
                ) : null}

                {/* Inline visual for narrow viewports, where nothing is pinned. */}
                <Reveal delay={stagger(3)} className="lg:hidden">
                  <RoleVisual index={index} label={role.role ?? role.title} className="mt-8" />
                </Reveal>

                {role.points.length > 0 ? (
                  <ul className="mt-8 space-y-4 border-t border-sidebar-border pt-8">
                    {role.points.map((point, pointIndex) => (
                      <Reveal
                        as="li"
                        key={point.text}
                        delay={stagger(pointIndex + 1)}
                        className="flex items-start gap-3"
                      >
                        <Check
                          className="mt-1 h-4 w-4 shrink-0 text-sidebar-primary"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block text-sm leading-relaxed text-sidebar-foreground sm:text-base">
                            {point.text}
                          </span>
                          {point.detail ? (
                            <span className="mt-1.5 block text-sm leading-relaxed text-sidebar-muted">
                              {point.detail}
                            </span>
                          ) : null}
                        </span>
                      </Reveal>
                    ))}
                  </ul>
                ) : null}

                {role.action ? (
                  <Reveal delay={stagger(2)}>
                    <CtaButton
                      href={role.action.href}
                      variant="onDark"
                      size="md"
                      showArrow
                      className="mt-8"
                    >
                      {role.action.label}
                    </CtaButton>
                  </Reveal>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
