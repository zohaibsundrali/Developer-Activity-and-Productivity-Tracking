/**
 * Regenerate the raster brand assets from the one source of truth.
 *
 *   node scripts/build-brand-icons.mjs
 *
 * Reads the mark geometry out of src/components/brand/brand.js and writes:
 *   src/app/icon.svg        32x32, rounded tile, indigo + white check
 *   src/app/favicon.ico     16 / 32 / 48, PNG-compressed entries
 *   src/app/apple-icon.png  180x180, full-bleed (iOS applies its own mask)
 *
 * Rasterising uses the Playwright chromium already installed for the e2e suite,
 * so there is no new dependency and no separate SVG renderer whose round caps
 * might disagree with the browser's. Run this after ANY change to
 * MARK_CHECK_POINTS / MARK_CHECK_WIDTH / MARK_TILE_RADIUS — the SVG and the
 * rasters drifting apart is the failure mode this script exists to prevent.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "src/app");

const { MARK_CHECK_POINTS, MARK_CHECK_WIDTH, MARK_TILE_RADIUS, BRAND_NAME } =
  await import(pathToFileURL(path.join(ROOT, "src/components/brand/brand.js")).href);

const INDIGO = "#4840DD"; // --primary 243 70% 56%
const D = MARK_CHECK_POINTS.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("");

/** `rx: 0` gives the full-bleed variant used for the Apple touch icon. */
const svg = (size, rx = MARK_TILE_RADIUS, label = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"` +
  (label ? ` role="img" aria-label="${label}"` : "") +
  `>\n  <rect width="32" height="32" rx="${rx}" fill="${INDIGO}"/>\n` +
  `  <path d="${D}" fill="none" stroke="#FFFFFF" stroke-width="${MARK_CHECK_WIDTH}"` +
  ` stroke-linecap="round" stroke-linejoin="round"/>\n</svg>`;

// --- icon.svg --------------------------------------------------------------
fs.writeFileSync(path.join(APP, "icon.svg"), svg(32, MARK_TILE_RADIUS, BRAND_NAME) + "\n");

// --- rasters ---------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(size, rx) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${svg(size, rx)}`
  );
  return page.locator("svg").screenshot({ omitBackground: true, type: "png" });
}

const SIZES = [16, 32, 48];
const frames = [];
for (const s of SIZES) frames.push(await png(s, MARK_TILE_RADIUS));

// ICO container: 6-byte header, one 16-byte directory entry per frame, then the
// PNG payloads. PNG-compressed entries are understood by every browser in use.
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);
const dir = Buffer.alloc(16 * SIZES.length);
let offset = header.length + dir.length;
SIZES.forEach((s, i) => {
  const o = i * 16;
  dir[o] = s === 256 ? 0 : s; // width  (0 means 256)
  dir[o + 1] = s === 256 ? 0 : s; // height
  dir.writeUInt16LE(1, o + 4); // colour planes
  dir.writeUInt16LE(32, o + 6); // bits per pixel
  dir.writeUInt32LE(frames[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += frames[i].length;
});
fs.writeFileSync(path.join(APP, "favicon.ico"), Buffer.concat([header, dir, ...frames]));

fs.writeFileSync(path.join(APP, "apple-icon.png"), await png(180, 0));

await browser.close();
console.log(`brand icons rebuilt from "${D}" — icon.svg, favicon.ico (${SIZES.join("/")}), apple-icon.png`);
