"use client";

/**
 * Footer.
 *
 * Navy chrome, matching the app's own sidebar, so the marketing page hands the
 * visitor over to the product in the colour they will meet it in.
 *
 * The content module marks unbuilt pages with `href: null` and explicitly asks
 * that they be rendered as plain text rather than dead links. That is what
 * happens here: the label is kept, the anchor is not. A privacy policy that is
 * listed but unwritten should look unwritten, not 404.
 *
 * Column count follows how many groups the content actually supplies, so a
 * two-group footer does not sit in a four-column grid with two empty cells.
 */

import Link from "next/link";

import Logo from "@/components/brand/Logo";
import { Container, Reveal, stagger } from "@/components/landing/primitives";
import { footer, list, pick, pickList, str } from "@/components/landing/content";

/**
 * True for an in-app route. Terms, Privacy and Data processing are real pages
 * in this app, and reaching them through a raw `<a href="/terms">` threw the
 * whole document away and rebooted the framework to move one route. They are
 * client transitions now. Protocol-relative and absolute URLs are not ours.
 */
function isInternalRoute(href) {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

/**
 * Scrolls to an in-page section without pushing a hash onto the URL.
 *
 * The link stays a real `<a href="#id">` — middle-click, right-click → open in
 * a new tab, copy-link and the no-JS case all still work, and it is still a
 * link for the keyboard. Only the plain left-click is taken over, because that
 * is the one that would otherwise leave `#pricing` sitting in the address bar
 * for the rest of the visit. Reduced motion gets an instant jump, not no jump.
 *
 * (Deliberately duplicated from SiteNav rather than hoisted into
 * `primitives.jsx`: the shared module is a contract other agents build
 * against in this pass, and twelve lines of local behaviour is a cheaper price
 * than widening it.)
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

  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/**
 * One footer destination. `next/link` for an in-app route, a plain anchor with
 * the no-hash scroll handler for an in-page section, a plain anchor for
 * anything external.
 */
function FooterLink({ href, className, children }) {
  if (isInternalRoute(href)) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} onClick={(event) => scrollToSection(event, href)} className={className}>
      {children}
    </a>
  );
}

function linkGroups() {
  return pickList(footer, "linkGroups", "columns", "groups", "sections", "nav")
    .map((group) => {
      if (!group || typeof group !== "object") return null;
      const title = pick(group, "title", "heading", "label", "name");
      const links = list(group.links ?? group.items ?? group.entries)
        .map((entry) => {
          const label = str(entry?.label ?? entry?.title ?? entry?.text ?? entry?.name);
          if (!label) return null;
          // `href: null` is deliberate in the content — keep the label, drop the link.
          const href = str(entry?.href ?? entry?.url ?? entry?.to);
          return { label, href };
        })
        .filter(Boolean);
      return links.length > 0 ? { title, links } : null;
    })
    .filter(Boolean);
}

export default function SiteFooter() {
  const groups = linkGroups();
  const brand = footer?.brand ?? footer ?? null;
  const tagline = pick(brand, "tagline", "description", "blurb", "summary");
  const copyright = pick(footer, "copyright", "legalNote", "rights");

  /*
    Mobile is two columns, not one stack. Four groups of three to five links
    stacked single-file is roughly 1200px of scrolling to get past a footer,
    and the labels are short enough that half a 375px screen holds them
    comfortably. From `sm` up the grid opens out to one column per group.
  */
  const columnClass =
    groups.length >= 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : groups.length === 3
        ? "sm:grid-cols-3"
        : groups.length === 2
          ? "sm:grid-cols-2"
          : "";

  /*
    `sidebar-primary-foreground` (pure white) rather than `background` for the
    bright step on this ground. `background` is the *page* colour: near-white in
    the light theme, where it reads fine, but 200 30% 8% in the dark theme —
    against a 200 45% 7% footer that is 1.02:1, i.e. invisible. White is 17.7:1
    in light and 18.6:1 in dark, and is what the token set already nominates for
    text on the navy.
  */
  const linkClass =
    "inline-flex rounded text-sm text-sidebar-foreground transition-colors duration-200 " +
    "hover:text-sidebar-primary-foreground focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-sidebar-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

  return (
    <footer className="border-t border-sidebar-border bg-sidebar text-sidebar-foreground">
      <Container className="py-14 sm:py-16">
        <div className="grid grid-cols-1 gap-12 text-center sm:text-left lg:grid-cols-12 lg:gap-8">
          <Reveal className="lg:col-span-4">
            <a
              href="#top"
              onClick={(event) => scrollToSection(event, "#top")}
              className="inline-flex items-center rounded-lg text-sidebar-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            >
              <Logo variant="full" className="text-lg" markClassName="text-sidebar-primary" />
              <span className="sr-only">Back to top</span>
            </a>

            {tagline ? (
              <p className="mx-auto mt-5 max-w-xs text-sm leading-relaxed text-sidebar-muted sm:mx-0">
                {tagline}
              </p>
            ) : null}
          </Reveal>

          {groups.length > 0 ? (
            <div
              className={["grid grid-cols-2 gap-x-6 gap-y-10 lg:col-span-8", columnClass]
                .filter(Boolean)
                .join(" ")}
            >
              {groups.map((group, index) => (
                <Reveal key={group.title ?? index} delay={stagger(index)}>
                  {group.title ? (
                    <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sidebar-primary-foreground">
                      {group.title}
                    </h2>
                  ) : null}
                  <ul className={group.title ? "mt-4 space-y-3" : "space-y-3"}>
                    {group.links.map((link) => (
                      <li key={`${group.title}-${link.label}`}>
                        {link.href ? (
                          <FooterLink href={link.href} className={linkClass}>
                            {link.label}
                          </FooterLink>
                        ) : (
                          <span className="text-sm text-sidebar-muted">{link.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              ))}
            </div>
          ) : null}
        </div>

        {copyright ? (
          /* Centred at every width. It is the one line in the footer that
             belongs to the whole page rather than to a column, and hanging it
             off the left edge under a twelve-column grid made it look like a
             fifth column that lost its heading. */
          <div className="mt-14 border-t border-sidebar-border pt-8">
            <p className="text-center text-sm text-sidebar-muted">{copyright}</p>
          </div>
        ) : null}
      </Container>
    </footer>
  );
}
