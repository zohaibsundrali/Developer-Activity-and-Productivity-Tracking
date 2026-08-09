"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import {
  BRAND_NAME,
  MARK_VIEW_BOX,
  MARK_TILE_RADIUS,
  MARK_CHECK_D,
  MARK_CHECK_POINTS,
  MARK_CHECK_WIDTH,
} from "./brand";

/**
 * Verisade brand mark — "the Verified V".
 *
 * A solid rounded tile with a single two-segment stroke knocked out of it: the
 * V of Verisade drawn as a check mark. See src/components/brand/brand.js for
 * the concept and the geometry, which lives there so server code (metadata,
 * the OG image, Stripe) can read the same numbers without crossing the
 * "use client" boundary.
 *
 * Colour: the tile is painted with `currentColor` and the check is a true
 * knockout via an SVG mask, so whatever is behind the logo shows through it.
 * One asset therefore covers every context — set the colour with a text
 * utility on `className`:
 *
 *   <Logo />                                    ink on the light background
 *   <Logo className="text-primary" />           indigo brand lockup
 *   <Logo className="text-sidebar-foreground"/> on the deep navy sidebar
 *   <Logo variant="mark" className="text-current" />   monochrome / print
 *
 * Geometry is defined once in ./brand.js and mirrored byte-for-byte in
 * src/app/icon.svg, src/app/favicon.ico, src/app/apple-icon.png and
 * src/app/opengraph-image.js.
 */

// Re-exported so the existing `@/components/brand` surface is unchanged.
export {
  BRAND_NAME,
  MARK_VIEW_BOX,
  MARK_TILE_RADIUS,
  MARK_CHECK_D,
  MARK_CHECK_POINTS,
  MARK_CHECK_WIDTH,
};

/**
 * The mark on its own. Square, `currentColor`, no text.
 *
 * @param {object}  props
 * @param {string} [props.className]  sizing + colour utilities (default `h-8 w-8`)
 * @param {string} [props.title]      accessible name; omit to render decoratively
 */
export function LogoMark({ className, title, ...props }) {
  // Unique per instance so several logos on one page can't share a mask id.
  const maskId = `verisade-mark-${useId().replace(/:/g, "")}`;
  const labelled = Boolean(title);

  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      className={cn("h-8 w-8", className)}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...props}
    >
      {labelled ? <title>{title}</title> : null}
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="32"
        height="32"
      >
        {/* white keeps the tile, black cuts the check back out of it */}
        <rect width="32" height="32" rx={MARK_TILE_RADIUS} fill="#fff" />
        <path
          d={MARK_CHECK_D}
          fill="none"
          stroke="#000"
          strokeWidth={MARK_CHECK_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <rect
        width="32"
        height="32"
        rx={MARK_TILE_RADIUS}
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

/**
 * The Verisade logo.
 *
 * @param {object}  props
 * @param {"full"|"mark"} [props.variant="full"]  lockup with wordmark, or mark only
 * @param {string} [props.className]  applied to the root element
 * @param {string} [props.title]      accessible name for the `mark` variant
 */
export default function Logo({ variant = "full", className, title, ...props }) {
  if (variant === "mark") {
    return <LogoMark className={className} title={title} {...props} />;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-base leading-none",
        className
      )}
      {...props}
    >
      <LogoMark className="h-[1.75em] w-[1.75em] shrink-0" />
      {/* Space Grotesk (font-display). "Verisade" is four syllables of even
          width, so it takes slightly less negative tracking than the old
          wordmark did to stay open at small sizes. */}
      <span className="font-display text-[1.0625em] font-bold tracking-[-0.015em]">
        {BRAND_NAME}
      </span>
    </span>
  );
}
