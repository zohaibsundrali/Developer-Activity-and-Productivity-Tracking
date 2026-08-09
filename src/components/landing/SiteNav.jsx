"use client";

/**
 * Sticky top navigation.
 *
 * `position: sticky` rather than `fixed`, so the header occupies its own space
 * in the flow and the hero below it never has to be padded to compensate — no
 * magic offset to keep in sync, and no layout shift when it engages.
 *
 * The only thing that changes on scroll is the ground: transparent over the top
 * of the hero, then a blurred translucent panel with a hairline rule once the
 * page has moved. That is driven by one passive, rAF-throttled scroll listener
 * that flips a single boolean, so it re-renders at most twice per visit rather
 * than once per frame.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

import Logo from "@/components/brand/Logo";
import { CtaButton } from "@/components/landing/primitives";
import {
  cta,
  ctas,
  finalCta,
  footer,
  hero,
  nav as navContent,
  pickList,
  str,
} from "@/components/landing/content";

/**
 * Last-resort wayfinding, used only if the content module offers no navigation
 * of its own. These are affordances pointing at sections of this page rather
 * than product copy, and any whose section did not render is dropped.
 */
const DEFAULT_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

function toLinks(entries) {
  return entries
    .map((entry) => {
      const label = str(entry?.label ?? entry?.text ?? entry?.title);
      const href = str(entry?.href ?? entry?.url ?? entry?.to);
      return label && href ? { label, href } : null;
    })
    .filter(Boolean);
}

/**
 * Nav links, in order of preference:
 *
 *   1. A `nav` export, if the content module ever grows one.
 *   2. The first footer group whose links are all in-page anchors. The footer
 *      already names every section of this page in the author's own words, so
 *      borrowing that group means the header labels are real content rather
 *      than something written here.
 *   3. `DEFAULT_LINKS`.
 */
function contentLinks() {
  const declared = toLinks(pickList(navContent, "links", "items", "nav"));
  if (declared.length > 0) return declared;

  const groups = pickList(footer, "linkGroups", "columns", "groups", "sections");
  for (const group of groups) {
    const links = toLinks(Array.isArray(group?.links) ? group.links : []);
    if (links.length >= 3 && links.every((link) => link.href.startsWith("#"))) return links;
  }

  return null;
}

/**
 * @param {Object} props
 * @param {Set<string>} props.sections ids of the sections that actually rendered
 */
export default function SiteNav({ sections }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);

  const links = (contentLinks() ?? DEFAULT_LINKS).filter(
    (link) => !link.href.startsWith("#") || !sections || sections.has(link.href.slice(1)),
  );

  // Nav actions are borrowed from copy that already exists on the page, so the
  // header can never advertise a destination or a label written here. The
  // secondary slot prefers the closing section's "sign in" over the hero's long
  // secondary label, which is a sentence rather than a button.
  const heroActions = ctas(hero);
  const navPrimary = cta(navContent?.primaryCta ?? navContent?.cta) ?? heroActions[0] ?? null;
  const navSecondary =
    cta(navContent?.secondaryCta ?? navContent?.signIn) ??
    cta(finalCta?.secondaryCta) ??
    heroActions[1] ??
    null;

  useEffect(() => {
    let frame = null;

    const read = () => {
      frame = null;
      setScrolled(window.scrollY > 12);
    };

    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  // Escape closes the mobile panel and returns focus to the control that opened
  // it, so keyboard users are never dropped at the top of the document.
  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      if (toggleRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  return (
    <header
      className={[
        "sticky top-0 z-50 w-full transition-colors duration-300 ease-out",
        // Opaque enough that the navy and indigo bands underneath cannot be
        // read through the header — a blurred pane you can still read text
        // through looks like a rendering bug, not a material.
        scrolled || open
          ? "border-b border-border bg-background/95 backdrop-blur-lg supports-[backdrop-filter]:bg-background/85"
          : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <nav aria-label="Main" className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4 lg:h-[4.5rem]">
          <a
            href="#top"
            className="inline-flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Logo variant="full" className="text-lg text-foreground" />
            <span className="sr-only">Home</span>
          </a>

          <ul className="hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-2 lg:flex">
            {navSecondary ? (
              <a
                href={navSecondary.href}
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {navSecondary.label}
              </a>
            ) : null}
            {navPrimary ? (
              <CtaButton href={navPrimary.href} variant="primary" size="md" className="shadow-card">
                {navPrimary.label}
              </CtaButton>
            ) : null}
          </div>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-nav-panel"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
          >
            {open ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </nav>

      {/*
        Unmounted rather than hidden, so its links are never reachable by Tab
        while the panel is closed.
      */}
      {open ? (
        <div
          id="site-nav-panel"
          ref={panelRef}
          className="border-t border-border bg-background lg:hidden"
        >
          <ul className="mx-auto w-full max-w-6xl px-5 py-3 sm:px-6">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center rounded-lg px-3 text-base font-medium text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          {navPrimary || navSecondary ? (
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-border px-5 py-4 sm:px-6">
              {navPrimary ? (
                <CtaButton
                  href={navPrimary.href}
                  variant="primary"
                  size="lg"
                  onClick={() => setOpen(false)}
                >
                  {navPrimary.label}
                </CtaButton>
              ) : null}
              {navSecondary ? (
                <CtaButton
                  href={navSecondary.href}
                  variant="secondary"
                  size="lg"
                  onClick={() => setOpen(false)}
                >
                  {navSecondary.label}
                </CtaButton>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
