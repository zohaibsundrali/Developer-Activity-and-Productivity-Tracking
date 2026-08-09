/**
 * Adapter between the landing page components and `src/content/landing.js`.
 *
 * The content module is owned by another author. This file is the single place
 * that knows its shape, so a rename over there is a one-line change here rather
 * than a hunt through nine components.
 *
 * Two rules govern everything below:
 *
 *  - **Nothing is invented.** Every reader returns `null` or `[]` when the
 *    content does not supply a value, and every component treats that as "render
 *    nothing". There is no placeholder copy anywhere on the page.
 *  - **Reasonable aliases are accepted.** `title`/`heading`/`headline` all mean
 *    the same thing to a copywriter; insisting on one spelling would strand real
 *    copy behind a key mismatch.
 */

import * as landingModule from "@/content/landing";

/**
 * Spread into a plain object on purpose. Reading an optional key straight off a
 * module namespace (`landingModule.nav`) makes webpack statically analyse it and
 * warn "Attempted import error" for every key the content module has not
 * defined — which, for a file full of optional sections, is noise on every
 * build. Spreading is a runtime read, so the optional keys stay optional.
 */
const landing = { ...landingModule };

/* ------------------------------------------------------------------ *
 * Primitive readers
 * ------------------------------------------------------------------ */

/** A displayable string, or null. Numbers are allowed (stats, prices). */
export function str(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** An array, always. */
export function list(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

/** First non-empty string among the given keys. */
export function pick(source, ...keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const found = str(source[key]);
    if (found) return found;
  }
  return null;
}

/** First non-empty array among the given keys. */
export function pickList(source, ...keys) {
  if (!source || typeof source !== "object") return [];
  for (const key of keys) {
    const found = list(source[key]);
    if (found.length > 0) return found;
  }
  return [];
}

/** A section that is authored as a bare array still has items. */
function asSection(value) {
  if (Array.isArray(value)) return { items: value };
  if (value && typeof value === "object") return value;
  return {};
}

/* ------------------------------------------------------------------ *
 * Composite readers
 * ------------------------------------------------------------------ */

/**
 * Normalises a call to action. A string on its own is treated as a label with
 * no destination, which the button renderer discards — a button that goes
 * nowhere is worse than no button.
 *
 * @returns {{ label: string, href: string } | null}
 */
export function cta(value) {
  if (!value) return null;
  if (typeof value === "string") return null;
  const label = pick(value, "label", "text", "title", "cta");
  const href = pick(value, "href", "url", "to", "link");
  if (!label || !href) return null;
  return { label, href };
}

/** The primary and secondary actions of a section, in that order. */
export function ctas(source) {
  if (!source || typeof source !== "object") return [];

  const explicit = [cta(source.primaryCta ?? source.primary), cta(source.secondaryCta ?? source.secondary)];
  const found = explicit.filter(Boolean);
  if (found.length > 0) return found;

  const grouped = pickList(source, "ctas", "actions", "buttons", "links");
  if (grouped.length > 0) return grouped.map(cta).filter(Boolean);

  const single = cta(source.cta);
  return single ? [single] : [];
}

/** Eyebrow / title / description for any section. */
export function heading(source) {
  const section = asSection(source);
  return {
    eyebrow: pick(section, "eyebrow", "kicker", "label", "tag", "overline"),
    title: pick(section, "title", "heading", "headline"),
    description: pick(section, "description", "subhead", "subtitle", "body", "copy", "intro"),
  };
}

/** Bullet lines, tolerating both `["a","b"]` and `[{text:"a"}]`. */
export function bullets(source, ...keys) {
  const raw = pickList(source, ...(keys.length > 0 ? keys : ["bullets", "points", "items", "features", "highlights"]));
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { text: str(entry), detail: null };
      const text = pick(entry, "text", "label", "title", "name");
      const detail = pick(entry, "detail", "description", "body");
      return text ? { text, detail } : null;
    })
    .filter(Boolean);
}

/** The item list of a section, whatever the author called it. */
export function items(source, ...keys) {
  const section = asSection(source);
  return pickList(section, ...(keys.length > 0 ? keys : ["items", "list", "entries"]));
}

/* ------------------------------------------------------------------ *
 * The sections themselves
 * ------------------------------------------------------------------ */

export const hero = landing.hero ?? null;
export const features = landing.features ?? null;
export const roleSections = landing.roleSections ?? null;
export const howItWorks = landing.howItWorks ?? null;
export const pricing = landing.pricing ?? null;
export const faq = landing.faq ?? null;
export const finalCta = landing.finalCta ?? null;
export const footer = landing.footer ?? null;

/**
 * The monitoring disclosure. Not in the original contract, but the content
 * module ships it *and* the hero's secondary call to action points straight at
 * it — dropping it would leave the hero linking to an anchor that is not on the
 * page.
 */
export const monitoring = landing.monitoring ?? null;

/**
 * The trust strip has no export of its own. It is assembled from a dedicated
 * export if one appears, and otherwise from the hero's trust line — a real
 * claim written by the content author, not a row of invented logos. If neither
 * exists the strip renders nothing.
 */
export const trust =
  landing.socialProof ??
  landing.trust ??
  landing.trustStrip ??
  (pick(landing.hero, "trustLine", "trust", "assurance") ? { line: pick(landing.hero, "trustLine", "trust", "assurance") } : null);

/** Navigation is likewise optional; see `SiteNav` for where its links come from. */
export const nav = landing.nav ?? landing.navigation ?? landing.header ?? null;

/** Anything the content module exports that this page has not claimed. */
export const extras = landing;
