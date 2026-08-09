/**
 * Shared identifiers for the legal documents.
 *
 * WHY THIS FILE EXISTS
 * The privacy policy, the DPA and the employee monitoring notice all have to
 * name the same legal entity, the same address and the same contact route. If
 * each document carried its own copy, one of them would eventually be updated
 * and the others would not. They import from here instead.
 *
 * EVERY VALUE MARKED `TBD` IS A DECISION THE OWNER MUST MAKE. None of them can
 * be derived from the codebase — there is no registered company name, no
 * postal address and no privacy contact anywhere in this repository. They are
 * left as an obvious placeholder rather than invented, and the pages render an
 * "open items" block listing them so an unfinished policy cannot be published
 * quietly.
 */

/** Rendered verbatim wherever the owner still has to supply a value. */
export const TBD = "[TO BE COMPLETED — see “Open items” at the end of this document]";

export const entity = {
  /**
   * Registered legal name of the company that operates the product.
   *
   * THIS IS NOT THE PRODUCT NAME. "Verisade" is what the software is called;
   * the processor named in a DPA has to be an actual legal person — the
   * registered company that signs the contract, which may well be named
   * something else entirely, and may not exist yet. Assuming the two are the
   * same is how a DPA ends up naming a party that cannot be sued or sue.
   *
   * The product name is written as a literal string in each document rather
   * than imported from here, deliberately: a privacy policy whose company name
   * changes depending on a JavaScript import is not a document anyone can rely
   * on or cite a version of.
   */
  legalName: "[PLACEHOLDER — owner to confirm registered company name]",

  /** Company registration number / equivalent. */
  companyNumber: TBD,

  /** Registered postal address. Required on a privacy notice in most jurisdictions. */
  registeredAddress: TBD,

  /** Where to write about privacy. A monitored mailbox, not a personal address. */
  privacyContactEmail: TBD,

  /** Where to report a suspected vulnerability or breach. */
  securityContactEmail: TBD,

  /**
   * Data protection officer, or the EU/UK Article 27 representative if the
   * company is established outside those territories. "Not appointed" is an
   * acceptable answer; leaving the question unanswered is not.
   */
  dataProtectionContact: TBD,

  /** Country/state whose law governs these documents and the courts that hear disputes. */
  governingJurisdiction: TBD,

  /** The lead supervisory authority a data subject may complain to. */
  supervisoryAuthority: TBD,

  /** Where the Supabase project and its object storage are physically hosted. */
  hostingRegion: TBD,
};

/**
 * The date these documents were last edited. Update it whenever the substance
 * changes — the pages render it, and a stale "last updated" is itself a
 * misleading statement.
 */
export const lastUpdated = "2026-08-09";

/**
 * Rendered at the top of every legal page. These documents were written by
 * reading the source code, which makes them accurate about the software. It
 * does not make them legal advice, and it does not make them compliant with any
 * particular country's employment or data protection law.
 */
export const legalReviewNotice = {
  title: "This is a starting point, not legal advice",
  text:
    "This document was drafted from the actual behaviour of the software: every factual claim in it was checked against the database schema and the code that reads and writes it. That makes it accurate about what the product does. It does not make it legal advice, and it has not been reviewed by a qualified lawyer. Monitoring employees is regulated differently in almost every country — several require prior consultation with a works council or union, some require a formal impact assessment before the first screenshot is taken, and a few prohibit parts of what this product can do. Have a lawyer qualified in your operating jurisdiction review and adapt this before you rely on it.",
};

const legalEntity = { TBD, entity, lastUpdated, legalReviewNotice };
export default legalEntity;
