/**
 * Brand constants — the single source of truth for the name and the mark.
 *
 * DELIBERATELY NOT a "use client" module. `src/components/brand/Logo.jsx` is a
 * client component, and every export of a "use client" module becomes an opaque
 * client reference when a Server Component imports it — a plain string would
 * arrive as a proxy object, not a string. Keeping the constants here lets
 * `layout.js`, `opengraph-image.js`, `stripeServer.js` and the content files
 * import them on the server, while `Logo.jsx` re-exports them so existing
 * client imports keep working.
 *
 * The next rename is one line: BRAND_NAME.
 */

/** The product name. Never hard-code the string anywhere else. */
export const BRAND_NAME = "Verisade";

/**
 * The origin the deployment actually answers on.
 *
 * FOLLOW-UP: this is still the old `devtrack-blush.vercel.app` hostname because
 * verisade.com has not been bought yet. Pointing canonical URLs, OG image URLs
 * and the social card's footer at a domain that does not resolve would be worse
 * than a stale-looking hostname. When the domain is purchased, set
 * NEXT_PUBLIC_SITE_URL and every consumer here updates at once.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://devtrack-blush.vercel.app";

/** `SITE_URL` without the scheme — for display, e.g. on the social card. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// The mark — "the Verified V"
// ---------------------------------------------------------------------------
//
// A solid rounded tile (the workspace: bounded, structured, tenant-scoped) with
// a single two-segment stroke knocked out of it. That stroke is a check mark
// and the V of Verisade at the same time. The arms leave the vertex at 34 deg
// and 29 deg off vertical — close enough to symmetric that the letterform
// reads — while the right arm is 1.7x the left, which is the proportion that
// makes the gesture unmistakably "checked, verified, signed off". One shape
// carries the monogram and the product's actual argument: nothing reaches Done
// unverified, and the record of that cannot be edited afterwards.
//
// Explicitly NOT an eye, a magnifying glass, a keyhole, a camera or a
// stopwatch. This product screenshots employees; surveillance iconography
// would be a trust problem, not a clever pun.
//
// Structure is deliberately identical to the mark it replaces — filled tile,
// one bold knocked-out path — because that is what survives a 16px favicon.
// The stroke is 4.5/32 = 14% of the tile (2.25px at 16px) and the knockout is
// optically centred: with round caps it spans 6.85..25.15 horizontally and
// 6.35..25.65 vertically, so both midpoints land exactly on 16.

/** 32x32 design grid — every icon asset is drawn on it. */
export const MARK_VIEW_BOX = "0 0 32 32";

/** Corner radius of the tile, on the 32-unit grid. */
export const MARK_TILE_RADIUS = 8;

/** Vertices of the check: arm start, vertex, arm end. */
export const MARK_CHECK_POINTS = [
  [9.1, 15.1],
  [14.7, 23.4],
  [22.9, 8.6],
];

/** Stroke thickness of the check, on the 32-unit grid. */
export const MARK_CHECK_WIDTH = 4.5;

/** The check as an SVG path command, derived so it can never drift. */
export const MARK_CHECK_D = MARK_CHECK_POINTS.map(
  ([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`
).join("");
