import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The chrome every screen renders.
 *
 * The admin sidebar has around twenty sections. Hand-polishing twenty screens
 * produces twenty dialects; the way to lift all of them at once — and keep them
 * looking like one product — is to raise the surfaces they all already use:
 *
 *   EmptyState   47 files
 *   PageHeader   25
 *   StatCard     16
 *   Section      14
 *   Toolbar       9
 *
 * These assertions are deliberately about the DESIGN DECISIONS, not about every
 * class name. A test that pins a whole className freezes the design and gets
 * deleted the first time somebody adjusts padding — which is worse than no test,
 * because it teaches people to ignore this file.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const HEADER = read("src/components/ui/page-header.jsx");
const EMPTY = read("src/components/ui/empty-state.jsx");
const TOOLBAR = read("src/components/ui/toolbar.jsx");
const STAT = read("src/components/shell/StatCard.jsx");
const BOARD = read("src/components/admin/ProjectBoard.jsx");
const DIRECTORY = read("src/components/admin/EmployeeDirectory.jsx");

describe("every page has a masthead, not floating text", () => {
  it("closes the header with a rule", () => {
    // Before this the title, the actions and the first card were three things
    // in the same column of space, and each screen decided its own spacing.
    expect(HEADER).toMatch(/border-b border-border/);
  });

  it("tightens the title, which is most of what separates a product masthead", () => {
    expect(HEADER).toMatch(/tracking-\[-0\.02em\]/);
  });
});

describe("the toolbar owns its own surface", () => {
  it("is a card", () => {
    expect(TOOLBAR).toMatch(/rounded-xl border border-border bg-card/);
  });

  it("matches the skeleton that always promised one", () => {
    // EmployeeDirectory's loading state drew the toolbar as a card while the
    // real toolbar was bare, so the page changed shape the moment data landed.
    const skeleton = DIRECTORY.slice(DIRECTORY.indexOf("if (loading)"), DIRECTORY.indexOf("// ── Error"));
    expect(skeleton).toMatch(/rounded-xl border border-border bg-card/);
  });

  it("is not double-wrapped by the one screen that hand-rolled it", () => {
    // A card inside a card. ProjectBoard built the same surface by hand; the
    // primitive owns it now.
    const around = BOARD.slice(BOARD.indexOf("{/* Toolbar"), BOARD.indexOf("<Toolbar"));
    expect(around).not.toMatch(/bg-card/);
  });
});

describe("the empty state is worth more than a grey circle", () => {
  it("carries a tinted, ringed icon rather than a flat chip", () => {
    // The most-rendered surface in the product, and the one a new installation
    // shows most — for a first-time user it IS the product.
    expect(EMPTY).toMatch(/bg-gradient-to-br from-primary\/15/);
    expect(EMPTY).toMatch(/ring-1 ring-inset/);
  });

  it("gives the title real weight", () => {
    expect(EMPTY).toMatch(/text-base font-semibold tracking-tight/);
  });
});

describe("cards behave the same way everywhere", () => {
  it("lifts on hover, and honours reduced motion", () => {
    // Motion is the cheapest way to make a surface feel responsive, and the
    // cheapest way to make it feel broken if it ignores the preference.
    expect(STAT).toMatch(/hover:-translate-y-0\.5/);
    expect(STAT).toMatch(/motion-reduce:transition-none/);
  });

  it("never animates without that guard, anywhere in the chrome", () => {
    for (const [name, src] of [
      ["StatCard", STAT],
      ["EmptyState", EMPTY],
      ["Toolbar", TOOLBAR],
      ["PageHeader", HEADER],
    ]) {
      const animated = /transition-(all|colors|shadow|transform|\[width\])/.test(src);
      if (!animated) continue;
      expect(src, `${name} animates without motion-reduce`).toMatch(/motion-reduce:/);
    }
  });

  it("tints the stat icons with the same gradient the org chart uses", () => {
    // Two screens built weeks apart should still look like one product.
    const chart = read("src/components/admin/orgChart.jsx");
    expect(STAT).toMatch(/bg-gradient-to-br from-primary\/15/);
    expect(chart).toMatch(/bg-gradient-to-br from-primary\/20/);
  });
});

describe("the chrome stays token-only", () => {
  it("introduces no literal colours", () => {
    // The palette is themeable; a hex here is a colour that cannot follow the
    // light/dark switch and will be wrong in one of them.
    for (const [name, src] of [
      ["PageHeader", HEADER],
      ["EmptyState", EMPTY],
      ["Toolbar", TOOLBAR],
      ["StatCard", STAT],
      ["Section", read("src/components/ui/section.jsx")],
    ]) {
      const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(body, `${name} has a literal colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, `${name} has a raw rgb()`).not.toMatch(/rgba?\(/);
    }
  });
});
