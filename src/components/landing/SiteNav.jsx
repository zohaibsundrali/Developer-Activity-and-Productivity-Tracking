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
 *
 * ---------------------------------------------------------------------------
 * Structure — three parts, borrowed from Hubstaff, minus the bloat
 * ---------------------------------------------------------------------------
 *
 *   [ logo ]   [ section links, left-of-centre ]   [ sign in · secondary · CTA ]
 *
 * The bar is 80px at `lg` rather than 64px, which is what makes it read as
 * chrome rather than as a strip. 80px is also exactly the `scroll-mt-20` every
 * section carries, so an anchor still lands below the header and not under it.
 *
 * The right-hand group is the part this nav previously lacked: one plain text
 * "Sign in", one outlined secondary, one solid primary. A returning customer
 * landing on the marketing page had nowhere to go before — every affordance
 * pointed at signup.
 *
 * What is deliberately NOT copied from Hubstaff, per the competitor teardown
 * done for this project: mega-menus, dropdown panels, and a nav carrying fifty
 * links. That nav is optimised for crawlable surface area, which is an SEO
 * position this product has not earned and does not need; it costs the visitor
 * the one decision the header exists to present. Every link here points at a
 * section that actually rendered, and there are five of them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import Logo from "@/components/brand/Logo";
import { Container, CtaButton } from "@/components/landing/primitives";
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

/**
 * Scrolls to an in-page section **without** pushing a hash onto the URL.
 *
 * The link stays a real `<a href="#id">`: middle-click, right-click → "open in
 * new tab", copy-link, and the no-JS case all keep working, and the element is
 * still a link for the keyboard and for assistive tech. All this does is take
 * over the plain left-click, where the default behaviour would rewrite the
 * address bar and leave `#pricing` sitting there for the rest of the visit.
 *
 * Guards, in order:
 *   - not an in-page target, or the section did not render → do nothing, let
 *     the browser resolve the href as it normally would;
 *   - a modified click (cmd/ctrl/shift/alt) or a non-primary button → that is
 *     the visitor asking for a new tab or window, so it is left alone.
 *
 * `prefers-reduced-motion` downgrades the smooth scroll to an instant jump
 * rather than removing the scroll, so the destination is still reached.
 */
function scrollToSection(event, href) {
  if (typeof href !== "string" || !href.startsWith("#") || href.length < 2) return;
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (typeof event.button === "number" && event.button !== 0) return;

  const target = document.getElementById(href.slice(1));
  if (!target) return;

  event.preventDefault();

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });

  // Keyboard and screen-reader users continue *from the section they asked
  // for* rather than from wherever the link was. `preventScroll` means moving
  // focus does not fight the smooth scroll that just started.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/**
 * True for an in-app route. Those must be client transitions — a raw `<a>` to
 * `/login` throws away the whole document and reloads the framework to move one
 * route. Protocol-relative (`//host`) and absolute URLs are somebody else's.
 */
function isInternalRoute(href) {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

/**
 * One nav destination. `next/link` for an in-app route, a plain anchor for an
 * in-page section or an external URL. Same props either way, so callers do not
 * have to know which they got.
 */
function NavAnchor({ href, children, ...rest }) {
  const Tag = isInternalRoute(href) ? Link : "a";
  return (
    <Tag href={href} {...rest}>
      {children}
    </Tag>
  );
}

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
 * Route-level actions the content already offers: the first footer group whose
 * links are all real routes rather than in-page anchors. On this content that is
 * the "Account" group — create an organization, join with an invite, sign in —
 * which is exactly the set the right-hand side of a header needs, written by the
 * content author rather than invented here.
 */
function accountActions() {
  const groups = pickList(footer, "linkGroups", "columns", "groups", "sections");
  for (const group of groups) {
    const links = toLinks(Array.isArray(group?.links) ? group.links : []);
    if (links.length >= 2 && links.every((link) => link.href.startsWith("/"))) return links;
  }
  return [];
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

  // Every nav action is borrowed from copy that already exists on the page, so
  // the header can never advertise a destination or a label written here.
  const heroActions = ctas(hero);
  const account = accountActions();

  // Solid primary — the one decision the header exists to present.
  const navPrimary = cta(navContent?.primaryCta ?? navContent?.cta) ?? heroActions[0] ?? null;

  // Plain text, for the visitor who already has an account. The hero's own
  // secondary is a sentence ("See exactly what the tracker records") and is
  // never used here; the closing section's is the real sign-in.
  const navSignIn =
    cta(navContent?.signIn) ??
    cta(finalCta?.secondaryCta) ??
    account[account.length - 1] ??
    null;

  // Outlined middle step. The account group's lead entry is the same offer the
  // primary already makes, so it is skipped; what is left on this content is
  // the invite path, which is a genuinely different intent. If the content
  // offers no third route, no third button is invented — the slot is dropped.
  const navSecondaryRaw =
    cta(navContent?.secondaryCta) ??
    account.slice(1).find((link) => link.href !== navSignIn?.href) ??
    null;
  const navSecondary =
    navSecondaryRaw &&
    navSecondaryRaw.label !== navPrimary?.label &&
    navSecondaryRaw.label !== navSignIn?.label
      ? navSecondaryRaw
      : null;

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
        //
        // While the mobile panel is open the header goes fully solid with *no*
        // backdrop filter. That is not only taste: `backdrop-filter` makes an
        // element a containing block for its fixed descendants, which would
        // pin the full-height panel to the 64px header instead of the viewport.
        open
          ? "border-b border-border bg-background"
          : scrolled
            ? "border-b border-border bg-background/95 backdrop-blur-lg supports-[backdrop-filter]:bg-background/85"
            : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <Container as="nav" aria-label="Main">
        <div className="flex h-16 items-center gap-4 lg:h-20 lg:gap-6">
          <a
            href="#top"
            onClick={(event) => scrollToSection(event, "#top")}
            className="inline-flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Logo variant="full" className="text-lg text-foreground" />
            <span className="sr-only">Home</span>
          </a>

          {/*
            Section links, grouped against the logo rather than pushed to the
            far side: the eye reads brand → sections → actions in one sweep
            instead of hunting three separate corners. Smaller and tighter than
            body copy — 14px against the page's 16px, on a 2px gap — so the row
            reads as navigation rather than as a sentence.
          */}
          <ul className="hidden items-center gap-0.5 lg:flex lg:ml-2 xl:ml-8">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={(event) => scrollToSection(event, link.href)}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium tracking-[-0.005em] text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          {/*
            Action hierarchy, quietest first: text → outline → solid. The
            outlined middle step is held back to `xl`; between 1024 and 1279 the
            five section links and three actions do not both fit on one row, and
            a wrapping header is worse than a header with two actions.
          */}
          <div className="ml-auto hidden items-center gap-1 lg:flex xl:gap-2">
            {navSignIn ? (
              <NavAnchor
                href={navSignIn.href}
                onClick={(event) => scrollToSection(event, navSignIn.href)}
                className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-foreground transition-colors duration-200 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {navSignIn.label}
              </NavAnchor>
            ) : null}
            {navSecondary ? (
              <CtaButton
                href={navSecondary.href}
                variant="ghost"
                size="sm"
                className="hidden xl:inline-flex"
              >
                {navSecondary.label}
              </CtaButton>
            ) : null}
            {navPrimary ? (
              <CtaButton href={navPrimary.href} variant="primary" size="sm" className="shadow-card">
                {navPrimary.label}
              </CtaButton>
            ) : null}
          </div>

          {/*
            The control changes *material*, not just its glyph. Closed it is a
            quiet outlined chip carrying a heavier three-bar rule than the
            default hairline hamburger; open it fills with the brand navy and
            the mark goes white — so the close reads as a deliberate second
            state of the same control, rather than as a stray × parked in the
            corner of the screen.
          */}
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-nav-panel"
            className={[
              "ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden",
              open
                ? "border-sidebar bg-sidebar text-sidebar-primary-foreground hover:bg-sidebar-accent"
                : "border-border bg-card text-foreground hover:bg-muted",
            ].join(" ")}
          >
            {open ? (
              <X className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
            )}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </Container>

      {/*
        Unmounted rather than hidden, so its links are never reachable by Tab
        while the panel is closed.

        Full height, pinned below the 64px bar: a menu that stops two thirds of
        the way down the screen leaves a strip of the page showing underneath
        and reads as a dropdown that failed to finish. `top-16` is the mobile
        bar height — the `lg:h-20` step never applies here, since the panel is
        `lg:hidden`. `overflow-y-auto` is the safety net for a long link list on
        a short landscape phone; it is the panel that scrolls, not the page.
      */}
      {open ? (
        <div
          id="site-nav-panel"
          ref={panelRef}
          className="fixed inset-x-0 bottom-0 top-16 flex flex-col overflow-y-auto bg-background lg:hidden"
        >
          {/*
            The link stack takes the free height and centres itself in it, so
            the menu reads as its own screen rather than as a list that fell to
            the top. Bold and centred: at this size the labels are the content,
            not a sidebar of them.
          */}
          <Container as="ul" className="flex flex-1 flex-col items-center justify-center gap-1 py-8">
            {links.map((link) => (
              <li key={link.href} className="w-full">
                <a
                  href={link.href}
                  onClick={(event) => {
                    scrollToSection(event, link.href);
                    setOpen(false);
                  }}
                  className="flex h-14 w-full items-center justify-center rounded-lg px-3 text-center text-lg font-bold tracking-[-0.01em] text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </Container>

          {navPrimary || navSecondary || navSignIn ? (
            /* Same hierarchy as the bar, stacked: solid, outline, then the
               plain sign-in. Nothing is dropped at this width — the outlined
               step is only held back on the desktop row, where it is a space
               problem rather than a priority one.

               `mt-auto` keeps this block on the floor of the panel however
               short the link list is, and the rule above it is drawn in the
               brand navy (`sidebar-border`) rather than the page hairline, so
               the foot of the menu is a deliberate edge you can see. */
            <Container className="mt-auto flex flex-col gap-2 border-t-2 border-sidebar-border py-6">
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
                  variant="ghost"
                  size="lg"
                  onClick={() => setOpen(false)}
                >
                  {navSecondary.label}
                </CtaButton>
              ) : null}
              {navSignIn ? (
                <NavAnchor
                  href={navSignIn.href}
                  onClick={(event) => {
                    scrollToSection(event, navSignIn.href);
                    setOpen(false);
                  }}
                  className="mt-1 inline-flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-foreground transition-colors duration-200 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {navSignIn.label}
                </NavAnchor>
              ) : null}
            </Container>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
