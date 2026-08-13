import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The admin shell polish pass.
 *
 * These are source-text and colour-maths assertions rather than render tests:
 * `vitest.config.mjs` runs `environment: 'node'` and no test in this suite
 * mounts a React tree. What they pin are the invariants that are easy to
 * silently undo — a duplicated title creeping back into the topbar, a lighter
 * one-off indigo reappearing next to the brand one, the theme class going back
 * to a `useEffect` (which reintroduces the flash), or the sign-out control
 * being removed from the last place it still exists.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SIDEBAR = read("src/components/shell/Sidebar.jsx");
const TOPBAR = read("src/components/shell/Topbar.jsx");
const APP_SHELL = read("src/components/shell/AppShell.jsx");
const LAYOUT = read("src/app/layout.js");
const TAILWIND = read("tailwind.config.js");
const GLOBALS = read("src/app/globals.css");
const DASHBOARD_PAGE = read("src/app/admin/dashboard/page.js");
const OVERVIEW = read("src/components/admin/DashboardOverview.jsx");

/** Strip block and line comments so prose about a removed feature cannot
 *  satisfy an assertion that the feature itself is gone. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SIDEBAR_CODE = code(SIDEBAR);
const TOPBAR_CODE = code(TOPBAR);
const DASHBOARD_CODE = code(DASHBOARD_PAGE);
const OVERVIEW_CODE = code(OVERVIEW);

/**
 * The prop block of a multi-line JSX element, e.g. `<Topbar\n …\n />`.
 * Terminates on a `/>` that starts its own line, so a self-closing element
 * passed as a prop value (`searchSlot={<Button … />}`) does not end the match
 * early — which a lazy `[\s\S]*?\/>` does.
 */
function jsxProps(source, name) {
  const start = source.indexOf(`<${name}\n`);
  expect(start, `<${name}> not found`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = /\n\s*\/>/.exec(rest);
  expect(end, `<${name}> is not self-closing`).toBeTruthy();
  return rest.slice(0, end.index);
}

// --------------------------------------------------------------------------
// Colour maths. Independent of the app: parses the raw HSL channel triples out
// of globals.css and derives WCAG 2.x contrast from first principles, so a
// token edit that quietly breaks a ratio fails here.
// --------------------------------------------------------------------------

/** Read a `--token: H S% L%;` declaration from a given CSS block. */
function readToken(css, name, { scope = ":root" } = {}) {
  // `:root { … }` and `.dark { … }` are both single-level blocks inside
  // `@layer base`, so a non-greedy match to the first `}` is exact.
  const block = new RegExp(`${scope.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(css);
  expect(block, `could not find the ${scope} block in globals.css`).toBeTruthy();
  const decl = new RegExp(`--${name}:\\s*([0-9.]+)\\s+([0-9.]+)%\\s+([0-9.]+)%`).exec(block[1]);
  expect(decl, `--${name} is not defined in ${scope}`).toBeTruthy();
  return { h: Number(decl[1]), s: Number(decl[2]) / 100, l: Number(decl[3]) / 100 };
}

function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.min(5, Math.floor(hp))];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255));
}

const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ratio = (cssA, cssB, opts) =>
  contrast(hslToRgb(readToken(GLOBALS, cssA, opts)), hslToRgb(readToken(GLOBALS, cssB, opts)));

// --------------------------------------------------------------------------

describe("item 19 — sidebar cleanup", () => {
  it("has no More button", () => {
    expect(SIDEBAR_CODE).not.toMatch(/>More</);
    expect(SIDEBAR_CODE).not.toMatch(/Scroll navigation down/);
    expect(SIDEBAR_CODE).not.toMatch(/scrollNavDown/);
    // The button's icon should have gone with it.
    expect(SIDEBAR_CODE).not.toMatch(/ChevronDown/);
  });

  it("has no logout control and no name/email block", () => {
    expect(SIDEBAR_CODE).not.toMatch(/Logout/);
    expect(SIDEBAR_CODE).not.toMatch(/LogOut/);
    expect(SIDEBAR_CODE).not.toMatch(/onLogout/);
    expect(SIDEBAR_CODE).not.toMatch(/displayEmail/);
    expect(SIDEBAR_CODE).not.toMatch(/displayName/);
  });

  it("no longer receives onLogout from the shell", () => {
    expect(jsxProps(APP_SHELL, "Sidebar")).not.toMatch(/onLogout/);
  });

  it("keeps the nav a real scroller, with padding taller than the bottom fade", () => {
    // The two halves of the overflow fix. `min-h-0` is what allows the flex
    // child to shrink below its content height so the list scrolls at all…
    expect(SIDEBAR_CODE).toMatch(/min-h-0 flex-1/);
    expect(SIDEBAR_CODE).toMatch(/overflow-y-auto/);

    // …and the bottom padding must exceed the fade's height, or the last row
    // is drawn under the gradient even at full scroll. That inequality was the
    // actual defect the More button was papering over.
    const padding = /overflow-y-auto px-3 pb-(\d+)/.exec(SIDEBAR_CODE);
    const fade = /absolute inset-x-0 bottom-0 h-(\d+) bg-gradient-to-t/.exec(SIDEBAR_CODE);
    expect(padding, "nav bottom padding not found").toBeTruthy();
    expect(fade, "bottom fade not found").toBeTruthy();
    expect(Number(padding[1])).toBeGreaterThan(Number(fade[1]));
  });
});

describe("logout still has exactly one home", () => {
  it("lives in the Topbar account menu", () => {
    expect(TOPBAR_CODE).toMatch(/onLogout/);
    expect(TOPBAR_CODE).toMatch(/Sign out/);
    expect(TOPBAR_CODE).toMatch(/role="menuitem"/);
    // The shell must still hand it down, or the last exit is inert.
    expect(jsxProps(APP_SHELL, "Topbar")).toMatch(/onLogout=\{onLogout\}/);
  });
});

describe("item 20 — light/dark mode", () => {
  it("is wired to the class strategy", () => {
    expect(TAILWIND).toMatch(/darkMode:\s*\["class"\]/);
    expect(GLOBALS).toMatch(/\.dark\s*\{/);
  });

  it("sets the class before first paint, not in an effect", () => {
    // A blocking inline <script> in <head>. If this ever moves into a
    // useEffect the app paints light and repaints dark on every load.
    expect(LAYOUT).toMatch(/<head>/);
    expect(LAYOUT).toMatch(/dangerouslySetInnerHTML/);
    const script = /const THEME_INIT_SCRIPT = `([\s\S]*?)`;/.exec(LAYOUT);
    expect(script, "THEME_INIT_SCRIPT not found in layout.js").toBeTruthy();
    expect(script[1]).toMatch(/classList\.toggle\("dark"/);
    // Persisted choice first, OS preference as the initial default.
    expect(script[1]).toMatch(/localStorage\.getItem\("devtrack\.theme"\)/);
    expect(script[1]).toMatch(/prefers-color-scheme: dark/);
    // Mutating <html> before hydration requires this or React warns.
    expect(LAYOUT).toMatch(/suppressHydrationWarning/);
  });

  it("runs the persisted choice through the same key the toggle writes", () => {
    expect(TOPBAR).toMatch(/const THEME_KEY = "devtrack\.theme"/);
    expect(TOPBAR_CODE).toMatch(/localStorage\.setItem\(THEME_KEY/);
    expect(TOPBAR_CODE).toMatch(/classList\.toggle\("dark"/);
  });

  it("offers a labelled toggle whose icon needs no JS state", () => {
    expect(TOPBAR_CODE).toMatch(/<ThemeToggle \/>/);
    expect(TOPBAR_CODE).toMatch(/aria-label="Toggle dark theme"/);
    expect(TOPBAR_CODE).toMatch(/aria-pressed=/);
    // Driven by the `dark:` variant, so the first painted icon is correct.
    expect(TOPBAR_CODE).toMatch(/<Moon className="h-5 w-5 dark:hidden"/);
    expect(TOPBAR_CODE).toMatch(/<Sun className="hidden h-5 w-5 dark:block"/);
  });

  it("gives every light token a dark counterpart", () => {
    const names = (scope) => {
      const block = new RegExp(`${scope}\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(GLOBALS)[1];
      return new Set([...block.matchAll(/--([a-z-]+):/g)].map((m) => m[1]));
    };
    const light = names(":root");
    const dark = names("\\.dark");
    // The radius scale is themeless by design; every colour token is not.
    const missing = [...light].filter((n) => !n.startsWith("radius") && !dark.has(n));
    expect(missing).toEqual([]);
  });
});

describe("item 22 — one brand colour", () => {
  it("--primary is the exact brand indigo #4840dd", () => {
    expect(toHex(hslToRgb(readToken(GLOBALS, "primary")))).toBe("#4840dd");
  });

  it("paints the selected sidebar item with it, not the lighter step", () => {
    const active = /isActive[\s\S]*?"(bg-[^"]*)"/.exec(SIDEBAR_CODE);
    expect(active, "active nav item classes not found").toBeTruthy();
    expect(active[1]).toMatch(/\bbg-primary\b/);
    expect(active[1]).not.toMatch(/bg-sidebar-primary\b/);
  });

  it("paints avatars and primary buttons with it", () => {
    // Topbar avatar — the only avatar left in the shell.
    expect(TOPBAR_CODE).toMatch(/rounded-full bg-primary text-sm font-bold text-primary-foreground/);
    expect(TOPBAR_CODE).not.toMatch(/bg-sidebar-primary\b/);
    // Button's `default` variant, the shell's primary action.
    expect(read("src/components/ui/button.jsx")).toMatch(/default: "bg-primary text-primary-foreground/);
  });

  it("improves the failing contrast rather than shipping it", () => {
    // Before: white on --sidebar-primary. Measured 3.97:1 — fails AA.
    const before = ratio("sidebar-primary-foreground", "sidebar-primary");
    expect(before).toBeLessThan(4.5);
    expect(before).toBeCloseTo(3.97, 1);

    // After: --primary-foreground on --primary. Light theme, ~6.81:1.
    const after = ratio("primary-foreground", "primary");
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(4.5);

    // The same pair in dark mode, where --primary IS the lighter step and the
    // foreground flips to near-black ink. Must also clear AA, or dark mode
    // ships the exact failure we just fixed in light mode.
    const dark = ratio("primary-foreground", "primary", { scope: ".dark" });
    expect(dark).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the logo mark on the lighter step, where it is the legible one", () => {
    // A graphic on navy, so the ratio that matters is mark-vs-sidebar and the
    // bar is 3:1, not 4.5:1. The brand indigo loses this one.
    expect(ratio("sidebar-primary", "sidebar")).toBeGreaterThanOrEqual(3);
    expect(ratio("primary", "sidebar")).toBeLessThan(3);
    expect(SIDEBAR_CODE).toMatch(/<LogoMark className="h-9 w-9 shrink-0 text-sidebar-primary" \/>/);
  });
});

describe("item 23 — dashboard subtitle", () => {
  it("no longer prints the glance/last-updated line", () => {
    expect(OVERVIEW_CODE).not.toMatch(/at a glance/);
    expect(OVERVIEW_CODE).not.toMatch(/last updated/i);
    expect(OVERVIEW_CODE).not.toMatch(/lastUpdated/);
    expect(OVERVIEW_CODE).not.toMatch(/formatTime/);
  });

  it("keeps the page h1 and the refresh action", () => {
    expect(OVERVIEW).toMatch(/<PageHeader\s+title=\{sectionTitle\("overview", "admin"\)\}/);
    // The label was "Refresh stats" when the screen was three counters. It
    // reloads the whole dashboard now, so the word "stats" was the wrong half
    // to keep. What item 23 actually protects is that a refresh action EXISTS
    // in the header and re-runs the load — asserted here rather than the
    // wording, which is not the guarantee.
    expect(OVERVIEW).toMatch(/onClick=\{load\}/);
    expect(OVERVIEW).toMatch(/\{loading \? "Refreshing…" : "Refresh"\}/);
  });
});

describe("item 24 — duplicate page titles", () => {
  it("removes the title and subtitle from the Topbar", () => {
    expect(TOPBAR_CODE).not.toMatch(/\{title\}/);
    expect(TOPBAR_CODE).not.toMatch(/\{subtitle\}/);
    expect(TOPBAR_CODE).not.toMatch(/subtitle &&/);
    // …and stops forwarding them.
    const topbarCall = jsxProps(APP_SHELL, "Topbar");
    expect(topbarCall).not.toMatch(/title=/);
    expect(topbarCall).not.toMatch(/subtitle=/);
  });

  it("drops the Signed in as subtitle", () => {
    expect(DASHBOARD_CODE).not.toMatch(/Signed in as/);
  });

  it("leaves the canonical h1 alone", () => {
    // The e2e suite addresses screens by getByRole('heading', { level: 1 }),
    // which resolves to PageHeader's h1 inside the content area.
    expect(read("src/components/ui/page-header.jsx")).toMatch(/<h1/);
    expect(OVERVIEW).toMatch(/<PageHeader/);
  });
});

describe("item 21 — organization created notification", () => {
  it("uses the existing sweetalert2 wrapper and adds no second pattern", () => {
    expect(DASHBOARD_PAGE).toMatch(/import \{ showSuccess \} from "@\/utils\/alerts"/);
    expect(DASHBOARD_PAGE).toMatch(/showSuccess\(\s*"Organization created"/);
    expect(DASHBOARD_PAGE).not.toMatch(/from ["']sweetalert2["']/);
    expect(DASHBOARD_CODE).not.toMatch(/toast|react-hot-toast|sonner/i);
  });

  it("fires once, not on every visit", () => {
    // The trigger is signup-only: sessionStorage `adminToken` is written by
    // the registration page and by nothing else, so a plain login never has it.
    expect(DASHBOARD_PAGE).toMatch(/SIGNUP_MARKER_KEY = "adminToken"/);
    expect(DASHBOARD_PAGE).toMatch(/WELCOME_SHOWN_KEY = "devtrack\.orgWelcomeShown"/);
    const effect = /firstArrival[\s\S]*?showSuccess\(/.exec(DASHBOARD_PAGE);
    expect(effect, "welcome effect not found").toBeTruthy();
    // Read both keys, and write the shown-marker BEFORE showing the dialog so a
    // reload — sessionStorage survives one — cannot repeat it.
    expect(effect[0]).toMatch(/getItem\(SIGNUP_MARKER_KEY\)/);
    expect(effect[0]).toMatch(/getItem\(WELCOME_SHOWN_KEY\)/);
    expect(effect[0]).toMatch(/setItem\(WELCOME_SHOWN_KEY, "1"\)/);
    expect(effect[0].indexOf("setItem(WELCOME_SHOWN_KEY")).toBeLessThan(
      effect[0].indexOf("showSuccess(")
    );
  });

  it("does not consume the key it does not own", () => {
    // `adminToken` belongs to the registration flow. Reading it is fine;
    // removing it would be editing someone else's session state.
    expect(DASHBOARD_PAGE).not.toMatch(/removeItem\(SIGNUP_MARKER_KEY\)/);
    expect(DASHBOARD_PAGE).not.toMatch(/removeItem\("adminToken"\)/);
  });
});
