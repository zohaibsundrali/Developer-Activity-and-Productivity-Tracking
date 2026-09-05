import { describe, it, expect } from "vitest";
import { buildProjectSummary } from "@/app/api/client/_lib/shapes.js";

/**
 * Regression: the client project LIST summary omitted `description`, so every
 * card in the client portal fell back to "No description provided." even when
 * the project had one. The summary must carry it through (the list route now
 * selects it), and default to null when absent.
 */
describe("buildProjectSummary — description", () => {
  const base = { id: "p1", name: "Site", status: "active", deadline: null, progress: 40 };

  it("carries the project description through to the card", () => {
    const out = buildProjectSummary({ project: { ...base, description: "Rebuild the marketing site" }, tasks: [], pendingApprovals: 0 });
    expect(out.description).toBe("Rebuild the marketing site");
  });

  it("is null (not undefined) when the project has no description", () => {
    const out = buildProjectSummary({ project: base, tasks: [], pendingApprovals: 0 });
    expect(out.description).toBeNull();
  });
});
