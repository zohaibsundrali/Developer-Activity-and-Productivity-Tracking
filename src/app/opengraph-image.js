import { ImageResponse } from "next/og";
import {
  BRAND_NAME,
  MARK_CHECK_POINTS,
  MARK_CHECK_WIDTH,
  MARK_TILE_RADIUS,
  SITE_HOST,
} from "@/components/brand/brand";

/**
 * Social card for every shared Verisade link.
 *
 * Drawn with the brand palette and Space Grotesk, self-hosted from
 * src/components/brand/fonts so nothing is fetched from a third party at
 * request time. The mark is rebuilt out of positioned, rotated rounded
 * rectangles rather than inline SVG: a stadium of length L+w rotated onto a
 * segment is pixel-identical to a round-capped, round-joined stroke, and the
 * two stadiums' end caps overlap at the vertex to form the round join. The
 * vertices come from the same constants the component and icon.svg use, so the
 * card cannot drift from the mark, and satori's patchy SVG mask support is
 * never in the picture.
 */

// Node runtime, not edge: `runtime = "edge"` on a metadata route makes Next 14
// resolve a Pages-Router /_document that does not exist, and the build dies
// AFTER "Compiled successfully" with PageNotFoundError. Reproduced twice,
// isolated by removing this file (exit 0), so it is this route, not the
// intermittent artifact bug. ImageResponse works fine on Node.
export const alt = `${BRAND_NAME} — developer activity and productivity tracking`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#0D1A21"; // --sidebar  200 45% 9%
const INDIGO = "#4840DD"; // --primary 243 70% 56%
const MIST = "#9FB1BB"; // --sidebar-foreground
const HAIRLINE = "#1C2E37"; // --sidebar-border

/** The mark, at `s` pixels square, on the shared 32-unit design grid. */
function Mark({ s }) {
  const u = s / 32; // one design unit in px
  const w = MARK_CHECK_WIDTH * u; // stroke thickness
  const r = w / 2; // stadium radius == round cap/join

  // One stadium per segment of the check, rotated onto it.
  const segments = MARK_CHECK_POINTS.slice(0, -1).map(([x1, y1], i) => {
    const [x2, y2] = MARK_CHECK_POINTS[i + 1];
    const dx = (x2 - x1) * u;
    const dy = (y2 - y1) * u;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return {
      position: "absolute",
      left: x1 * u + dx / 2 - (len + w) / 2,
      top: y1 * u + dy / 2 - r,
      width: len + w,
      height: w,
      borderRadius: r,
      background: "#FFFFFF",
      transformOrigin: "50% 50%",
      transform: `rotate(${angle}deg)`,
    };
  });

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: s,
        height: s,
        borderRadius: MARK_TILE_RADIUS * u,
        background: INDIGO,
      }}
    >
      {segments.map((style, i) => (
        <div key={i} style={style} />
      ))}
    </div>
  );
}

export default async function OpengraphImage() {
  let fonts;
  try {
    const [bold, medium] = await Promise.all([
      fetch(
        new URL("../components/brand/fonts/SpaceGrotesk-Bold.ttf", import.meta.url)
      ).then((res) => res.arrayBuffer()),
      fetch(
        new URL("../components/brand/fonts/SpaceGrotesk-Medium.ttf", import.meta.url)
      ).then((res) => res.arrayBuffer()),
    ]);
    fonts = [
      { name: "Space Grotesk", data: bold, weight: 700, style: "normal" },
      { name: "Space Grotesk", data: medium, weight: 500, style: "normal" },
    ];
  } catch {
    // Never fail a build or a crawl over a font: fall back to the built-in face.
    fonts = undefined;
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background: NAVY,
          backgroundImage: `linear-gradient(130deg, ${NAVY} 45%, #1A2A5C 100%)`,
          fontFamily: "Space Grotesk",
          color: "#FFFFFF",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark s={76} />
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, letterSpacing: "-0.015em" }}>
            {BRAND_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              maxWidth: 900,
            }}
          >
            Know where the engineering hours actually go.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 500,
              lineHeight: 1.4,
              color: MIST,
              maxWidth: 820,
            }}
          >
            Live sessions, focus time and delivery progress for every team — one
            workspace per organization, isolated by role.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 28,
            borderTop: `2px solid ${HAIRLINE}`,
            fontSize: 24,
            fontWeight: 500,
            color: MIST,
          }}
        >
          <div style={{ display: "flex", gap: 28 }}>
            <div style={{ display: "flex" }}>Activity</div>
            <div style={{ display: "flex", color: HAIRLINE }}>/</div>
            <div style={{ display: "flex" }}>Sessions</div>
            <div style={{ display: "flex", color: HAIRLINE }}>/</div>
            <div style={{ display: "flex" }}>Projects</div>
          </div>
          <div style={{ display: "flex", color: "#FFFFFF" }}>{SITE_HOST}</div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
