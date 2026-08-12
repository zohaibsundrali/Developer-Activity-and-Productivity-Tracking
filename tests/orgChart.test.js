import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Team Structure org chart.
 *
 * It was a vertical list of cards. It is now a chart: project → manager →
 * team leads → one branch per role, with drawn connecting lines.
 *
 * TWO THINGS THIS FILE EXISTS TO HOLD
 *
 * 1. THE ONE HONESTY CONSTRAINT. No line is drawn from a team lead to a
 *    member. `memberships.reports_to` is null for every member of this
 *    organization — checked against the live database, not assumed — so there
 *    is no data saying who reports to which lead. A drawn line would invent a
 *    reporting structure and then be believed. The leads are a LEVEL; the role
 *    branches hang from the same trunk, claiming only what is true: these
 *    people are all on this project.
 *
 * 2. THE GEOMETRY. A hand-drawn CSS tree looks broken in exactly two ways: a
 *    rail that sticks out past the outermost child, and a rail drawn for a
 *    lone child (a horizontal line to nowhere). Both are handled by cases that
 *    are easy to delete by accident.
 *
 * These assertions used to live in hierarchyAndAttachments.test.js and were
 * lost when that file was rewritten around the shared loader. They are back,
 * against the file the markup actually lives in now.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

const CHART = code("src/components/admin/orgChart.jsx");
const SCREEN = code("src/components/admin/ProjectHierarchy.jsx");

describe("it is a chart, not a list", () => {
  it("draws trunks and rails between the levels", () => {
    expect(CHART).toMatch(/export function Trunk/);
    expect(CHART).toMatch(/export function Branches/);
    // The trunk is a real line, not a gap.
    expect(CHART).toMatch(/h-8 w-px bg-border/);
  });

  it("uses all three rail cases, so it stops at the outer children", () => {
    // first: from its own centre rightwards. last: leftwards. middle: across.
    expect(CHART).toContain('"left-1/2 right-0"');
    expect(CHART).toContain('"left-0 right-1/2"');
    expect(CHART).toContain('"left-0 right-0"');
  });

  it("draws NO rail for a lone child", () => {
    // A horizontal line to nowhere is what makes a hand-made tree look broken.
    expect(CHART).toMatch(/const only = items\.length === 1/);
    expect(CHART).toMatch(/only\s*\?\s*null/);
  });

  it("no longer renders the stacked cards it replaced", () => {
    expect(SCREEN).not.toMatch(/function ProjectCard/);
    expect(SCREEN).toMatch(/function ProjectChart/);
    // …and the helpers that only the cards used are gone rather than orphaned.
    for (const dead of ["AvatarStack", "PersonRow", "function ProgressBar"]) {
      expect(SCREEN, `${dead} left behind`).not.toContain(dead);
    }
  });

  it("scrolls a wide level instead of wrapping it", () => {
    // The rail is drawn across ONE row. A wrapped second row would sit under a
    // line that does not reach it.
    expect(SCREEN).toContain("ScrollStrip");
    expect(SCREEN).toMatch(/w-max min-w-full/);
  });
});

describe("the hierarchy it claims is the hierarchy it has", () => {
  it("puts the manager on a level of its own, between project and team", () => {
    const chart = SCREEN.slice(SCREEN.indexOf("function ProjectChart"));
    const managerAt = chart.indexOf("EmptyManagerNode");
    const rolesAt = chart.indexOf("RoleBranch");
    expect(managerAt).toBeGreaterThan(-1);
    expect(rolesAt).toBeGreaterThan(-1);
    expect(managerAt).toBeLessThan(rolesAt);
  });

  it("lifts team leads OUT of the role branches into their own level", () => {
    expect(SCREEN).toMatch(/byRole\.find\(\(g\) => g\.role === "team_lead"\)/);
    expect(SCREEN).toMatch(/byRole\.filter\(\(g\) => g\.role !== "team_lead"\)/);
  });

  it("draws no line from a lead to a member", () => {
    // THE honesty constraint. reports_to is null for everyone, so such a line
    // would be invented. Leads render as siblings of the role branches under
    // one trunk, never as their parents.
    const chart = SCREEN.slice(SCREEN.indexOf("function ProjectChart"));
    // Each level is opened by its own Trunk; the role branches must not be
    // nested inside the leads' Branches element.
    const leadsBlock = chart.slice(chart.indexOf("leads.length > 0"), chart.indexOf("roleBranches.length > 0"));
    expect(leadsBlock).not.toContain("RoleBranch");
  });

  it("says so when there is no manager rather than leaving a gap", () => {
    // A gap in a chart reads as "still loading".
    expect(CHART).toMatch(/export function EmptyManagerNode/);
    expect(CHART).toMatch(/No manager/);
    expect(CHART).toMatch(/Set one in Project Hub/);
  });

  it("still says when nobody is on the project at all", () => {
    expect(SCREEN).toMatch(/Nobody is on this project yet/);
  });
});

describe("what each node shows", () => {
  it("gives a person an avatar, a name and a role", () => {
    expect(CHART).toMatch(/export function PersonNode/);
    expect(CHART).toContain("<Avatar person={person}");
    expect(CHART).toContain("roleLabel(person.role)");
    expect(CHART).toContain("roleVariant(person.role)");
  });

  it("puts the progress bar on the PROJECT node, with the number beside it", () => {
    // Progress is a property of the work, not of who is doing it. And a bar
    // alone is a shape somebody has to estimate.
    const node = CHART.slice(CHART.indexOf("export function ProjectNode"));
    expect(node).toContain('role="progressbar"');
    expect(node).toContain("aria-valuenow={pct}");
    expect(node).toMatch(/\{pct\}%/);
  });

  it("clamps a progress value that is out of range or not a number", () => {
    expect(CHART).toMatch(/Math\.max\(0, Math\.min\(100, Math\.round\(Number\(health\.progress\) \|\| 0\)\)\)/);
  });

  it("keeps the collapse accessible", () => {
    const node = CHART.slice(CHART.indexOf("export function ProjectNode"));
    expect(node).toContain("aria-expanded={expanded}");
    expect(node).toContain("aria-controls={panelId}");
  });

  it("hides the decorative lines from screen readers", () => {
    // A reader announcing four empty spans between every level is worse than
    // no chart at all.
    const rails = CHART.match(/bg-border/g) || [];
    const hidden = CHART.match(/aria-hidden="true"/g) || [];
    expect(rails.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThanOrEqual(rails.length);
  });

  it("says how many people a role branch is hiding, rather than an ellipsis", () => {
    // A count somebody can act on beats a "…" they have to click to understand.
    expect(CHART).toMatch(/\+\{rest\} more/);
  });
});
