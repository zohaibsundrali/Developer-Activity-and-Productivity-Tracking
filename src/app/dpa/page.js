/**
 * Data Processing Addendum page.
 *
 * A server component, same arrangement as /privacy: the copy lives in
 * `src/content/legal/dpa.js`, the reading layout lives in
 * `src/components/legal/LegalDocument.jsx`, and this file only joins them.
 *
 * The employee monitoring notice is rendered here as an annex rather than on a
 * route of its own, because that is what it is: the Addendum tells the customer
 * that informing their staff is their obligation, and the annex is the
 * ready-made document for discharging it. Keeping the two on one page means the
 * person who reads the obligation cannot miss the thing that satisfies it, and
 * the whole document — contract plus template — prints and sends as one file.
 */

import LegalDocument from "@/components/legal/LegalDocument";
import dpa from "@/content/legal/dpa";
import monitoringNotice from "@/content/legal/monitoring-notice";

export function generateMetadata() {
  return {
    title: dpa.title,
    description:
      `The terms on which Verisade processes your employees' data on your behalf: roles, ` +
      "instructions, confidentiality, security measures, sub-processors, breach notification, " +
      "deletion and audit rights — plus a plain-language monitoring notice you can give your staff.",
    alternates: { canonical: "/dpa" },
    openGraph: {
      type: "article",
      url: "/dpa",
      title: `${dpa.title} · Verisade`,
      description:
        "You are the controller of your employees' data. We are the processor. This is that agreement, written against what the software actually does.",
    },
    robots: { index: true, follow: true },
  };
}

export default function DpaPage() {
  return (
    <LegalDocument
      document={dpa}
      annex={monitoringNotice}
      annexLabel="Annex — employee monitoring notice"
      backHref="/"
      backLabel="Back to Verisade"
      related={[
        {
          href: "/privacy",
          label: "Privacy Policy",
          note: "what is recorded, what is not, and who can see it",
        },
        { href: "/terms", label: "Terms of Service", note: "plans, limits and responsibilities" },
      ]}
    />
  );
}
