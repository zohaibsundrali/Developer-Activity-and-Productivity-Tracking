/**
 * Static hero composition — the no-motion, no-WebGL, no-3D-budget path.
 *
 * This file is deliberately free of any `three` import, any client hook and any
 * `"use client"` directive. It is what renders on the server, what renders on a
 * phone, what renders under `prefers-reduced-motion: reduce`, and what renders
 * when WebGL is unavailable or is lost mid-session. Nothing here can drag the
 * 3D bundle in behind it — see the note in `SceneLoader.jsx` for how that is
 * enforced at the import-graph level.
 *
 * It is not a placeholder. The people who land here are the ones on a phone, on
 * a slow machine, or with motion sensitivity turned on, and they get the same
 * composition everyone else gets — the same three layers, the same lattice, the
 * same depth grading — just held still. That is possible because this file also
 * owns the geometry: the SVG below is a real pinhole projection of the exact
 * node cloud `HeroScene` animates, frozen at one scroll position. Sharing the
 * data means the still cannot drift away from the scene when either is edited.
 *
 * The direction of the dependency matters: the scene imports the geometry from
 * here, never the other way round, so the geometry always sits on the light
 * side of the dynamic-import boundary.
 *
 * Every colour is `currentColor` inheriting from a Tailwind `text-*` token, so
 * the palette lands from the CSS custom properties with no hex anywhere.
 */

/* ------------------------------------------------------------------ *
 * Shared geometry (consumed by HeroScene)
 * ------------------------------------------------------------------ */

/**
 * mulberry32 — a tiny deterministic PRNG. Determinism matters twice over: the
 * server and the client must produce byte-identical SVG or hydration
 * complains, and the scene's scattered pose should be a considered composition
 * that survives a reload, not a different tangle every visit.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GRID_COLS = 13;
export const GRID_ROWS = 7;
export const NODE_COUNT = GRID_COLS * GRID_ROWS;
export const DUST_COUNT = 180;
export const BOKEH_COUNT = 9;

const LATTICE_WIDTH = 5.2;
const LATTICE_HEIGHT = 2.8;

/** Shared camera framing, so the still and the scene agree on composition. */
export const CAMERA_Z_NEAR = 5;
export const CAMERA_Z_FAR = 6.6;
export const CAMERA_Y_START = 0.25;
export const CAMERA_Y_END = -0.15;

/** Fog band, in world distance from the camera. Also drives the still's grading. */
export const FOG_NEAR = 5.5;
export const FOG_FAR = 19;

/**
 * Three layers at three depths, which is what produces parallax on scroll and
 * a real sense of space when still:
 *
 *   dust    — far behind, heavily fogged. Ambient activity, never in focus.
 *   lattice — the subject. Two poses for the same 91 nodes:
 *               `scattered` = a loose cloud (raw activity),
 *               `settled`   = an ordered grid on a softly bowed surface.
 *             The scene lerps one into the other on scroll; that resolve is the
 *             entire idea of the piece.
 *   bokeh   — a few large, very faint discs in front of the camera plane. They
 *             read as out-of-focus foreground, which is the cheapest honest
 *             depth-of-field there is: no post-processing pass, no second
 *             render target, just geometry that was never meant to be sharp.
 */
function buildGeometry() {
  const random = mulberry32(0x5eed1a77);

  const settled = new Float32Array(NODE_COUNT * 3);
  const scattered = new Float32Array(NODE_COUNT * 3);
  // Per-node phase offset so the idle breathing is a drift across the surface
  // rather than 91 nodes pulsing in lockstep.
  const phase = new Float32Array(NODE_COUNT);

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const i = row * GRID_COLS + col;
      const u = col / (GRID_COLS - 1) - 0.5; // -0.5 .. 0.5
      const v = row / (GRID_ROWS - 1) - 0.5;

      const x = u * LATTICE_WIDTH;
      const y = -v * LATTICE_HEIGHT;
      // A gentle bow: the middle of the surface leans toward the camera and the
      // edges fall away. Enough to read as a surface, not enough to notice.
      const z = 0.55 * Math.cos(u * Math.PI) + 0.12 * Math.cos(v * Math.PI * 2);

      settled[i * 3] = x;
      settled[i * 3 + 1] = y;
      settled[i * 3 + 2] = z;

      scattered[i * 3] = x + (random() * 2 - 1) * 1.6;
      scattered[i * 3 + 1] = y + (random() * 2 - 1) * 1.1;
      scattered[i * 3 + 2] = z + (random() * 2 - 1) * 1.8;

      phase[i] = random() * Math.PI * 2;
    }
  }

  // Edges follow grid adjacency, so the settled pose is a clean wireframe and
  // the scattered pose is the same connections pulled out of shape. The
  // connections never change — only the positions do. That is the point: the
  // structure was always there, the scroll just reveals it.
  const pairs = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const i = row * GRID_COLS + col;
      if (col < GRID_COLS - 1) pairs.push(i, i + 1);
      if (row < GRID_ROWS - 1) pairs.push(i, i + GRID_COLS);
    }
  }

  const dust = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    dust[i * 3] = (random() * 2 - 1) * 8;
    dust[i * 3 + 1] = (random() * 2 - 1) * 5;
    dust[i * 3 + 2] = -2.5 - random() * 10.5; // -2.5 .. -13
  }

  const bokeh = new Float32Array(BOKEH_COUNT * 3);
  const bokehSize = new Float32Array(BOKEH_COUNT);
  for (let i = 0; i < BOKEH_COUNT; i += 1) {
    bokeh[i * 3] = (random() * 2 - 1) * 4;
    bokeh[i * 3 + 1] = (random() * 2 - 1) * 2.4;
    bokeh[i * 3 + 2] = 1.2 + random() * 1.2; // 1.2 .. 2.4, ahead of the lattice
    bokehSize[i] = 0.32 + random() * 0.48;
  }

  return { settled, scattered, phase, edges: new Uint16Array(pairs), dust, bokeh, bokehSize };
}

export const GEOMETRY = buildGeometry();

/** Shared easing, so the still is a real frame of the animation, not a pose. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ------------------------------------------------------------------ *
 * Projection for the still
 * ------------------------------------------------------------------ */

// Taken near the end of the resolve. The organised state is the beautiful one
// and the one that says something about the product, so the visitor who will
// never see it move gets that frame — with just enough residual scatter left to
// read as texture rather than as a screenshot of a grid.
const STILL_PROGRESS = 0.68;

const VIEW_W = 800;
const VIEW_H = 500;
const FOCAL = 650;

// Camera pose matching the still's point on the scroll.
const STILL_CAMERA_Z = CAMERA_Z_FAR + (CAMERA_Z_NEAR - CAMERA_Z_FAR) * STILL_PROGRESS;
const STILL_CAMERA_Y = CAMERA_Y_START + (CAMERA_Y_END - CAMERA_Y_START) * STILL_PROGRESS;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function project(x, y, z) {
  const distance = STILL_CAMERA_Z - z;
  const scale = FOCAL / distance;
  return {
    x: VIEW_W / 2 + x * scale,
    y: VIEW_H / 2 - (y - STILL_CAMERA_Y) * scale,
    scale,
    distance,
    // The same linear fog the WebGL scene applies, evaluated by hand. 0 = clear,
    // 1 = fully dissolved into the page background.
    fog: clamp01((distance - FOG_NEAR) / (FOG_FAR - FOG_NEAR)),
  };
}

/** One `<path>` command that draws a filled circle, for batching many dots. */
function circlePath(cx, cy, r) {
  const d = round2(r);
  return `M${round(cx)} ${round(cy)}m${-d} 0a${d} ${d} 0 1 0 ${d * 2} 0a${d} ${d} 0 1 0 ${-d * 2} 0`;
}

function buildStill() {
  const mix = easeInOutCubic(STILL_PROGRESS);
  const { settled, scattered, edges, dust, bokeh, bokehSize } = GEOMETRY;

  /* --- lattice ---------------------------------------------------- */
  const nodes = new Array(NODE_COUNT);
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < NODE_COUNT; i += 1) {
    const x = scattered[i * 3] + (settled[i * 3] - scattered[i * 3]) * mix;
    const y = scattered[i * 3 + 1] + (settled[i * 3 + 1] - scattered[i * 3 + 1]) * mix;
    const z = scattered[i * 3 + 2] + (settled[i * 3 + 2] - scattered[i * 3 + 2]) * mix;
    nodes[i] = project(x, y, z);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const span = maxZ - minZ || 1;
  for (let i = 0; i < NODE_COUNT; i += 1) {
    // 0 = back of the lattice, 1 = front. Drives size and weight.
    nodes[i].depth = clamp01((STILL_CAMERA_Z - nodes[i].distance - minZ) / span);
  }

  const circles = nodes.map((p, i) => ({
    key: i,
    cx: round(p.x),
    cy: round(p.y),
    r: round2(Math.max(1.3, 0.03 * p.scale)),
    // Kept in a narrow band and well under half opacity: this sits behind hero
    // copy, and a field of high-contrast dots behind text is a legibility bug
    // wearing a nice outfit.
    opacity: round2((0.22 + p.depth * 0.4) * (1 - p.fog * 0.8)),
  }));

  // 162 edges collapse into two `<path>` elements — a near half and a far half —
  // rather than 162 `<line>` nodes. Two weights is enough to read as depth.
  let nearEdges = "";
  let farEdges = "";
  for (let i = 0; i < edges.length; i += 2) {
    const a = nodes[edges[i]];
    const b = nodes[edges[i + 1]];
    const segment = `M${round(a.x)} ${round(a.y)}L${round(b.x)} ${round(b.y)}`;
    if ((a.depth + b.depth) / 2 >= 0.5) nearEdges += segment;
    else farEdges += segment;
  }

  /* --- dust ------------------------------------------------------- */
  // Bucketed into four opacity tiers and emitted as four paths. 180 separate
  // `<circle>` elements would be 180 nodes of server-rendered HTML for a layer
  // nobody is meant to consciously see.
  const dustTiers = [0, 0, 0, 0].map(() => "");
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const p = project(dust[i * 3], dust[i * 3 + 1], dust[i * 3 + 2]);
    const visibility = 1 - p.fog;
    if (visibility <= 0.02) continue;
    const tier = Math.min(3, Math.floor(visibility * 4));
    dustTiers[tier] += circlePath(p.x, p.y, Math.max(0.6, 0.016 * p.scale));
  }

  /* --- bokeh ------------------------------------------------------ */
  const bokehDiscs = [];
  for (let i = 0; i < BOKEH_COUNT; i += 1) {
    const p = project(bokeh[i * 3], bokeh[i * 3 + 1], bokeh[i * 3 + 2]);
    bokehDiscs.push({
      key: i,
      cx: round(p.x),
      cy: round(p.y),
      r: round(bokehSize[i] * p.scale),
    });
  }

  return { circles, nearEdges, farEdges, dustTiers, bokehDiscs };
}

const STILL = buildStill();

// Tier index -> fill opacity. Far dust barely registers; that is the job.
const DUST_TIER_OPACITY = [0.05, 0.09, 0.14, 0.2];

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

/**
 * @param {Object} props
 * @param {string} [props.className] classes for the wrapper element
 */
export default function HeroSceneFallback({ className = "" }) {
  return (
    <div
      className={`pointer-events-none h-full w-full text-primary ${className}`.trim()}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        role="presentation"
        focusable="false"
      >
        <defs>
          <radialGradient id="hero-still-glow" cx="50%" cy="44%" r="64%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.13" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.05" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>

          {/* A disc with no hard edge — an out-of-focus highlight, not a dot. */}
          <radialGradient id="hero-still-bokeh" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.07" />
            <stop offset="62%" stopColor="currentColor" stopOpacity="0.04" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>

          {/* Dissolves the composition into the page at the left and right edges
              instead of stopping it at a hard boundary. */}
          <linearGradient id="hero-still-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="20%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="80%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <mask id="hero-still-mask">
            <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#hero-still-fade)" />
          </mask>
        </defs>

        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#hero-still-glow)" />

        <g mask="url(#hero-still-mask)">
          {/* Far layer, in the deep navy tone. Fogged toward the page
              background, exactly as the WebGL fog does it. */}
          <g className="text-sidebar">
            {STILL.dustTiers.map((d, tier) =>
              d ? (
                <path
                  key={tier}
                  d={d}
                  fill="currentColor"
                  fillOpacity={DUST_TIER_OPACITY[tier]}
                />
              ) : null,
            )}
          </g>

          {/* Subject layer. */}
          <path
            d={STILL.farEdges}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.13"
            strokeWidth="1"
            strokeLinecap="round"
          />
          <path
            d={STILL.nearEdges}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.24"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {STILL.circles.map((node) => (
            <circle
              key={node.key}
              cx={node.cx}
              cy={node.cy}
              r={node.r}
              fill="currentColor"
              fillOpacity={node.opacity}
            />
          ))}

          {/* Foreground, deliberately out of focus. */}
          {STILL.bokehDiscs.map((disc) => (
            <circle
              key={disc.key}
              cx={disc.cx}
              cy={disc.cy}
              r={disc.r}
              fill="url(#hero-still-bokeh)"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
