"use client";

/**
 * Decorative backdrop for the auth brand pane.
 *
 * Purely presentational: no state, no data, no interactivity. It is
 * `aria-hidden` and `pointer-events: none`, so it can never intercept a click
 * or reach a screen reader.
 *
 * Everything it draws is coloured from design tokens (`--primary`, `--info`,
 * `--success`, `--foreground`) via the stylesheet — nothing is hardcoded, so a
 * palette change moves it automatically.
 *
 * All geometry below is a fixed constant, never randomised: the server and the
 * client must render byte-identical markup or React will report a hydration
 * mismatch.
 */

// x / y in the 0–100 viewBox, r in the same units, and the twinkle timing.
const NODES = [
  { x: 14, y: 18, r: 1.1, delay: "0s", duration: "7s" },
  { x: 31, y: 9, r: 0.7, delay: "1.4s", duration: "9s" },
  { x: 46, y: 24, r: 1.4, delay: "0.6s", duration: "8s" },
  { x: 64, y: 13, r: 0.8, delay: "2.2s", duration: "11s" },
  { x: 82, y: 27, r: 1, delay: "1s", duration: "9.5s" },
  { x: 22, y: 44, r: 0.9, delay: "2.8s", duration: "10s" },
  { x: 40, y: 55, r: 1.3, delay: "0.3s", duration: "8.5s" },
  { x: 59, y: 46, r: 0.8, delay: "3.4s", duration: "12s" },
  { x: 77, y: 60, r: 1.1, delay: "1.8s", duration: "9s" },
  { x: 12, y: 71, r: 1, delay: "4s", duration: "10.5s" },
  { x: 33, y: 84, r: 0.75, delay: "2.4s", duration: "11.5s" },
  { x: 55, y: 76, r: 1.2, delay: "0.9s", duration: "8s" },
  { x: 72, y: 90, r: 0.8, delay: "3s", duration: "10s" },
  { x: 89, y: 78, r: 1, delay: "1.6s", duration: "9s" },
];

// Sparse links — a network, not a mesh.
const LINKS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [2, 6],
  [6, 7],
  [7, 8],
  [4, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [8, 13],
  [12, 13],
  [7, 11],
];

export default function AuthBackdrop({ className = "" }) {
  return (
    <div className={`auth-backdrop ${className}`} aria-hidden="true">
      <span className="auth-backdrop__wash" data-wash="primary" />
      <span className="auth-backdrop__wash" data-wash="accent" />
      <span className="auth-backdrop__wash" data-wash="support" />
      <span className="auth-backdrop__grid" />

      <svg
        className="auth-constellation"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <g className="auth-constellation__links">
          {LINKS.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              className="auth-constellation__link"
              x1={NODES[a].x}
              y1={NODES[a].y}
              x2={NODES[b].x}
              y2={NODES[b].y}
            />
          ))}
        </g>
        <g>
          {NODES.map((node, i) => (
            <circle
              key={i}
              className="auth-constellation__node"
              cx={node.x}
              cy={node.y}
              r={node.r}
              style={{
                animationDelay: node.delay,
                animationDuration: node.duration,
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
