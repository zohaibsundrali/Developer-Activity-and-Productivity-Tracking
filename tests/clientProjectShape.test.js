import { describe, it, expect } from "vitest";
import { buildProjectSummary, countOpenTasks, computeProgress } from "@/app/api/client/_lib/shapes.js";

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


describe("client project task lifecycle", () => {
  it("keeps returned work and review work open until completion", () => {
    const tasks = ["pending", "in_progress", "submitted", "reviewed", "rejected", "completed"].map(status => ({ status }));
    expect(countOpenTasks(tasks)).toBe(5);
    expect(computeProgress(tasks, 100)).toBe(17);
  });

  it("does not tell a client that a project with only rejected work has no open tasks", () => {
    const summary = buildProjectSummary({ project: { id: "p1", name: "Site", progress: 100 }, tasks: [{ status: "rejected" }], pendingApprovals: 0 });
    expect(summary.open_tasks).toBe(1);
    expect(summary.progress).toBe(0);
  });

  it("closes the returned task only after it is completed", () => {
    expect(countOpenTasks([{ status: "completed" }])).toBe(0);
    expect(computeProgress([{ status: "completed" }], 0)).toBe(100);
  });
});
