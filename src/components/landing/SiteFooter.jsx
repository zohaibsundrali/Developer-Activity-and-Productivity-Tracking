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

import Logo from "@/components/brand/Logo";
import { Container, Reveal, stagger } from "@/components/landing/primitives";
import { footer, list, pick, pickList, str } from "@/components/landing/content";

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

  const columnClass =
    groups.length >= 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : groups.length === 3
        ? "sm:grid-cols-3"
        : groups.length === 2
          ? "sm:grid-cols-2"
          : "";

  const linkClass =
    "inline-flex rounded text-sm text-sidebar-foreground transition-colors duration-200 " +
    "hover:text-background focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-sidebar-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

  return (
    <footer className="border-t border-sidebar-border bg-sidebar text-sidebar-foreground">
      <Container className="py-14 sm:py-16">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8">
          <Reveal className="lg:col-span-4">
            <a
              href="#top"
              className="inline-flex items-center rounded-lg text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            >
              <Logo variant="full" className="text-lg" />
              <span className="sr-only">Back to top</span>
            </a>

            {tagline ? (
              <p className="mt-5 max-w-xs text-sm leading-relaxed text-sidebar-muted">{tagline}</p>
            ) : null}
          </Reveal>

          {groups.length > 0 ? (
            <div className={["grid grid-cols-1 gap-10 lg:col-span-8", columnClass].filter(Boolean).join(" ")}>
              {groups.map((group, index) => (
                <Reveal key={group.title ?? index} delay={stagger(index)}>
                  {group.title ? (
                    <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-background">
                      {group.title}
                    </h2>
                  ) : null}
                  <ul className={group.title ? "mt-4 space-y-3" : "space-y-3"}>
                    {group.links.map((link) => (
                      <li key={`${group.title}-${link.label}`}>
                        {link.href ? (
                          <a href={link.href} className={linkClass}>
                            {link.label}
                          </a>
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
          <div className="mt-14 border-t border-sidebar-border pt-8">
            <p className="text-sm text-sidebar-muted">{copyright}</p>
          </div>
        ) : null}
      </Container>
    </footer>
  );
}
