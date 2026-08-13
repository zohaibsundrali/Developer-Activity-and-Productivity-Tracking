import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The full-screen waits — the first thing the product shows anybody.
 *
 * WHAT WAS WRONG
 *
 * There were three of them and they did not match.
 *
 *   AuthLoadingScreen   the branded one: lockup, spinner, role="status".
 *   BillingGate         a grey sentence centred on a bare background. No mark,
 *                       no spinner, nothing moving, no live region. On a slow
 *                       connection this is the FIRST full screen an admin sees
 *                       after signing in, and a lone line of muted text reads
 *                       as a page that failed rather than one that is working.
 *   PortalBoot          a hand-rolled ring and a grey line. Correct behaviour,
 *                       but unbranded — a client's first screen of the product
 *                       carried nothing saying whose product it was.
 *
 * All three are the same moment to the person in front of them, so there is now
 * one screen. That is the property this file holds: not "a spinner exists
 * somewhere", but that the two hand-rolled ones are GONE and cannot come back
 * as a near-match nobody notices.
 *
 * The dashboards are deliberately NOT in scope. They show skeletons, which is
 * the right answer once the shape of the content is known; a spinner there
 * would be a downgrade.
 */

const ReactNs = await import("react");
globalThis.React = ReactNs.default ?? ReactNs;
const { createElement: h } = globalThis.React;
const { renderToStaticMarkup } = await import("react-dom/server");

const AuthLoadingScreen = (await import("@/components/auth/AuthLoadingScreen")).default;
const { BRAND_NAME } = await import("@/components/brand/brand");

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const GATE = stripComments(read("src/components/billing/BillingGate.jsx"));
const PORTAL = stripComments(read("src/app/client/page.jsx"));

describe("the one wait screen carries the brand and an indicator", () => {
  const markup = renderToStaticMarkup(h(AuthLoadingScreen, { message: "Loading your workspace…" }));

  it("says Verisade, visibly and not only to a screen reader", () => {
    // Read from the brand module, not typed here — a rename must not need this
    // test edited.
    expect(BRAND_NAME).toBeTruthy();
    expect(markup).toContain(BRAND_NAME);

    // Mutation-checked: deleting the <Logo> left this passing, because the
    // sr-only span at the foot of the screen still carried the name. The word
    // has to be ON the screen, so the check is made against markup with the
    // sr-only element removed.
    const visible = markup.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "");
    expect(visible).toContain(BRAND_NAME);
  });

  it("draws the mark, not only the word", () => {
    expect(markup).toContain("<svg");
    // The mark is a knockout mask, so it survives any ground colour.
    expect(markup).toContain("mask");
  });

  it("has something moving", () => {
    // A wait with a static screen is indistinguishable from a wait that ended
    // badly. The spin is what says the product is still working.
    expect(markup).toContain("animate-spin");
    // …and an escape for anyone who has asked the OS for less motion.
    expect(markup).toContain("motion-reduce:animate-none");
  });

  it("shows the message it was given", () => {
    expect(markup).toContain("Loading your workspace…");
    expect(renderToStaticMarkup(h(AuthLoadingScreen, { message: "Loading your portal…" })))
      .toContain("Loading your portal…");
  });

  it("keeps its own default when nobody passes one", () => {
    expect(renderToStaticMarkup(h(AuthLoadingScreen))).toContain("Checking your session…");
  });

  it("is announced as a live, busy status", () => {
    // Without these a screen reader is told nothing at all while the app boots.
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
  });

  it("names the product for a screen reader too", () => {
    expect(markup).toContain("sr-only");
  });

  it("paints its own ground rather than inheriting one", () => {
    // It is shown over whatever was there before; a transparent wait screen
    // renders on top of the page it is supposed to be replacing.
    expect(markup).toContain("bg-sidebar");
    expect(markup).toContain("min-h-screen");
  });
});

describe("the hand-rolled waits are gone", () => {
  it("the billing gate shows the branded screen", () => {
    expect(GATE).toMatch(
      /import AuthLoadingScreen from "@\/components\/auth\/AuthLoadingScreen"/
    );
    expect(GATE).toMatch(/<AuthLoadingScreen message="Loading your workspace…" \/>/);
  });

  it("the billing gate no longer draws a bare sentence on a blank page", () => {
    // The exact shape that was there. Asserting on the ABSENCE of the old
    // markup is what stops it being pasted back beside the new one.
    expect(GATE).not.toMatch(/<p className="text-sm text-muted-foreground">Loading/);
  });

  it("the client portal boot shows the branded screen", () => {
    expect(PORTAL).toMatch(
      /import AuthLoadingScreen from "@\/components\/auth\/AuthLoadingScreen"/
    );
    expect(PORTAL).toMatch(/<AuthLoadingScreen message="Loading your portal…" \/>/);
  });

  it("the client portal no longer hand-draws a spinner ring", () => {
    // A second spinner built from border utilities is how two waits end up
    // nearly matching — near-matching is worse than differing, because nobody
    // can tell which screen they are on.
    expect(PORTAL).not.toMatch(/animate-spin rounded-full border-\[3px\]/);
  });

  it("still routes both waits through one component", () => {
    // If a third `min-h-screen` wait appears in either file, it is a new
    // hand-rolled screen and this is the assertion that says so. The gate keeps
    // TWO of its own full-screen states — "workspace is paused" and the trial
    // banner's locked view — which are not waits and are not counted here.
    for (const [name, source] of [["gate", GATE], ["portal", PORTAL]]) {
      const waits = source.match(/min-h-screen[^"]*"[\s\S]{0,400}?Loading/g) || [];
      expect(waits.length, `${name} should hand-roll no wait screens`).toBe(0);
    }
  });
});
