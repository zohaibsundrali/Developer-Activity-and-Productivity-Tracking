/**
 * Privacy Policy page.
 *
 * A server component. It authors no copy: every word comes from
 * `src/content/legal/privacy.js`, and the reading layout — 68ch measure, real
 * heading hierarchy, sticky table of contents, "last updated" date — comes from
 * `src/components/legal/LegalDocument.jsx`. This file only wires the two
 * together and supplies the page metadata.
 *
 * `robots` is deliberately index/follow. A monitoring product's privacy policy
 * is a document people should be able to find and read before their employer
 * installs the agent, and search engines are how they will find it.
 */

import LegalDocument from "@/components/legal/LegalDocument";
import privacy from "@/content/legal/privacy";

export function generateMetadata() {
  return {
    title: privacy.title,
    description:
      `What Verisade records on a monitored machine and what it does not: screen captures, ` +
      "application and window-title history, keystroke counts (never keystroke content), and " +
      "active-versus-idle time. Who can see it, how long it is kept, and which third parties receive it.",
    alternates: { canonical: "/privacy" },
    openGraph: {
      type: "article",
      url: "/privacy",
      title: `${privacy.title} · Verisade`,
      description:
        "Written from the source code rather than a template — including the parts that are not flattering.",
    },
    robots: { index: true, follow: true },
  };
}

export default function PrivacyPage() {
  return (
    <LegalDocument
      document={privacy}
      backHref="/"
      backLabel="Back to Verisade"
      related={[
        {
          href: "/dpa",
          label: "Data Processing Addendum",
          note: "the contract terms for customers, with the employee notice template attached",
        },
        { href: "/terms", label: "Terms of Service", note: "plans, limits and responsibilities" },
      ]}
    />
  );
}
