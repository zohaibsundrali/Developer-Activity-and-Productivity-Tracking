import { describe, it, expect, vi } from "vitest";

// teamProductivity is a pure function; the module only imports the client at the
// top, so an empty stub is enough to load it.
vi.mock("@/utils/supabaseClient", () => ({ supabase: {} }));

import { teamProductivity, timeTrackingRows, deadlineDelays } from "@/utils/reportsData";

/**
 * Regression for the desktop-hours attribution bug: teamProductivity keyed the
 * per-employee roll-up on `s.developer_id`, but productivity_sessions has no
 * such column (loadDesktopSessions selects user_id). So `byId` was always empty
 * and any session carrying a user_id but no user_email was dropped — the
 * person's Tracked hours and Avg productivity read low. It must key on user_id.
 */
describe("teamProductivity — desktop-hours attribution", () => {
  const employees = [{ userId: "u1", email: "a@example.com", name: "A", role: "developer", userType: "developer" }];

  it("attributes a session that carries user_id but no user_email", () => {
    const sessions = [{ user_id: "u1", total_duration: 3600, productivity_score: 80 }];
    const [row] = teamProductivity({ employees, tasks: [], timeLogs: [], sessions });
    expect(row.trackedHours).toBe(1); // 3600s = 1h — was 0 before the fix
    expect(row.avgProductivity).toBe(80);
  });

  it("still attributes by user_email when the session has no user_id", () => {
    const sessions = [{ user_email: "a@example.com", total_duration: 1800 }];
    const [row] = teamProductivity({ employees, tasks: [], timeLogs: [], sessions });
    expect(row.trackedHours).toBe(0.5);
  });

  it("does not double-count a session that carries both id and email", () => {
    const sessions = [{ user_id: "u1", user_email: "a@example.com", total_duration: 3600 }];
    const [row] = teamProductivity({ employees, tasks: [], timeLogs: [], sessions });
    expect(row.trackedHours).toBe(1);
  });
});

describe("typed time-log report attribution", () => {
  const employees = [
    { userId: "shared-id", userType: "developer", name: "Developer", email: "dev@example.test", role: "developer" },
    { userId: "shared-id", userType: "admin", name: "Admin", email: "admin@example.test", role: "admin" },
  ];
  const timeLogs = [
    { developer_id: "shared-id", user_type: "developer", seconds: 3600, ended_at: "2026-09-12", started_at: "2026-09-12" },
    { developer_id: "shared-id", user_type: "admin", seconds: 7200, ended_at: "2026-09-12", started_at: "2026-09-12" },
    { developer_id: "shared-id", user_type: null, seconds: 10800, ended_at: "2026-09-12", started_at: "2026-09-12" },
  ];

  it("keeps admin and developer hours separate despite a colliding UUID", () => {
    const rows = teamProductivity({ employees, tasks: [], timeLogs, sessions: [] });
    expect(rows.map(r => [r.userType, r.loggedHours])).toEqual([["developer", 1], ["admin", 2]]);
  });

  it("never assigns developer desktop or task signals to the colliding admin", () => {
    const rows = teamProductivity({ employees, timeLogs: [],
      tasks: [{ developer_id: "shared-id", status: "completed", productivity_points: 5 }],
      sessions: [{ user_id: "shared-id", total_duration: 3600, productivity_score: 80 },
        { user_email: "admin@example.test", total_duration: 7200, productivity_score: 90 }],
    });
    expect(rows[0]).toMatchObject({ total: 1, trackedHours: 1, avgProductivity: 80 });
    expect(rows[1]).toMatchObject({ total: 0, trackedHours: 0, avgProductivity: null });
  });

  it("resolves displayed names by typed identity and leaves legacy ownership unresolved", () => {
    const rows = timeTrackingRows({ timeLogs, employees, tasks: [], projects: [] });
    expect(rows.map(r => r.developer)).toEqual(["Developer", "Admin", "Unknown (identity unresolved)"]);
    expect(rows.map(r => r.hours)).toEqual([1, 2, 3]);
  });

  it("does not infer a profile type from role or a matching UUID", () => {
    const untyped = [{ userId: "shared-id", name: "Unverified", role: "developer" }];
    const [row] = teamProductivity({ employees: untyped, timeLogs, tasks: [],
      sessions: [{ user_id: "shared-id", total_duration: 3600 }] });
    expect(row).toMatchObject({ loggedHours: 0, trackedHours: 0, avgProductivity: null });
    expect(timeTrackingRows({ timeLogs, employees: untyped, tasks: [], projects: [] })[0].developer).toBe("Unknown");
  });
});

it("deadline reports resolve developer task owners without a colliding admin name", () => {
  const tasks = [{ developer_id: "shared-id", status: "completed", task_title: "Late work",
    due_date: "2026-09-01", actual_completion_date: "2026-09-03" }];
  const developer = { userId: "shared-id", userType: "developer", name: "Developer" };
  const admin = { userId: "shared-id", userType: "admin", name: "Admin" };
  expect(deadlineDelays({ tasks, projects: [], employees: [developer, admin] })[0].assignee).toBe("Developer");
  expect(deadlineDelays({ tasks, projects: [], employees: [admin] })[0].assignee).toBe("Unassigned");
});
