/**
 * Marketing landing page.
 *
 * A server component: the whole page — headline, features, pricing, FAQ — is in
 * the initial HTML. Only the pieces that genuinely need the client (the nav's
 * scroll state, the reveal observers, the 3D scene) carry `"use client"`, and
 * every one of them renders its finished state on the server first. Turn
 * JavaScript off and the page is complete, just still.
 *
 * Section order: nav → hero → trust strip → two-halves → features → roles →
 * monitoring → how it works → pricing → FAQ → final CTA → footer.
 *
 * Monitoring sits *after* the role stories on purpose. Read earlier it lands as
 * a disclaimer before the reader knows what the product is; read after the
 * three role stories it lands as a specification, which is what it is.
 *
 * Grounds alternate background / muted / background / muted / navy /
 * background / muted / background / muted / indigo / navy, so no two adjacent
 * bands share a colour and the page has a rhythm you can feel while scrolling
 * past it at speed.
 *
 * Every section renders itself only if the content module gave it something to
 * say, and the nav filters its own links to the sections that survived — so a
 * content edit can never leave an anchor pointing at nothing.
 */

import SiteNav from "@/components/landing/SiteNav";
import Hero from "@/components/landing/Hero";
import TrustStrip from "@/components/landing/TrustStrip";
import TwoHalves from "@/components/landing/TwoHalves";
import Features from "@/components/landing/Features";
import RoleStories from "@/components/landing/RoleStories";
import Monitoring from "@/components/landing/Monitoring";
import HowItWorks from "@/components/landing/HowItWorks";
import Pricing from "@/components/landing/Pricing";
import Faq from "@/components/landing/Faq";
import FinalCta from "@/components/landing/FinalCta";
import SiteFooter from "@/components/landing/SiteFooter";

import {
  extras,
  faq,
  features,
  howItWorks,
  items,
  monitoring,
  pricing,
  roleSections,
  str,
} from "@/components/landing/content";

/**
 * Ids of the anchors that will actually exist once the page has rendered, for
 * the nav to filter its links against. Includes the per-role ids, which the
 * footer links to directly.
 */
function presentSections() {
  const present = new Set(["top"]);

  if (items(features, "items", "list", "cards", "features").length > 0) present.add("features");

  const roles = items(roleSections, "items", "roles", "list", "sections");
  if (roles.length > 0) {
    present.add("roles");
    roles.forEach((role) => {
      const id = str(role?.id ?? role?.anchor ?? role?.slug);
      if (id) present.add(id);
    });
  }

  if (extras.twoHalves) present.add(str(extras.twoHalves.id) ?? "one-system");
  if (monitoring) present.add(str(monitoring.id) ?? "monitoring");
  if (items(howItWorks, "steps", "items", "list").length > 0) present.add("how-it-works");
  if (items(pricing, "plans", "tiers", "items", "list").length > 0) present.add("pricing");
  if (items(faq, "items", "questions", "list", "faqs").length > 0) present.add("faq");

  return present;
}

/*
 * No `generateMetadata` here on purpose.
 *
 * `src/app/layout.js` already owns the site metadata — title (with a
 * `%s · <brand>` template), description, canonical, Open Graph and Twitter
 * cards — and it is the file that carries the product name. A page-level
 * override would have to build its title from `BRAND_NAME`, which is behind a
 * `"use client"` boundary and cannot be read from a Server Component (verified:
 * interpolating it in a server component throws `Cannot convert a Symbol value
 * to a string`). Overriding with a brand-less headline would strip the product
 * name out of the tab and desynchronise it from the OG card, which is worse
 * than inheriting. Left to the layout deliberately.
 */

export default function LandingPage() {
  const sections = presentSections();

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      
      {/*
        Skip link. Hidden until focused, then pinned over the nav — the first
        stop for a keyboard user and the only way past a header full of links.
      */}
      <a
        href="#main"
        className="sr-only z-[60] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:inline-flex focus:h-11 focus:items-center focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-elevated focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Skip to content
      </a>

      <SiteNav sections={sections} />

      <main id="main">
        <Hero />
        <TrustStrip />
        <TwoHalves />
        <Features />
        <RoleStories />
        <Monitoring />
        <HowItWorks />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  );
}
