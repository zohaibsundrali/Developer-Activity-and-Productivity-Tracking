import { describe, it, expect, vi } from "vitest";

// teamProductivity is a pure function; the module only imports the client at the
// top, so an empty stub is enough to load it.
vi.mock("@/utils/supabaseClient", () => ({ supabase: {} }));

import { teamProductivity } from "@/utils/reportsData";

/**
 * Regression for the desktop-hours attribution bug: teamProductivity keyed the
 * per-employee roll-up on `s.developer_id`, but productivity_sessions has no
 * such column (loadDesktopSessions selects user_id). So `byId` was always empty
 * and any session carrying a user_id but no user_email was dropped — the
 * person's Tracked hours and Avg productivity read low. It must key on user_id.
 */
describe("teamProductivity — desktop-hours attribution", () => {
  const employees = [{ userId: "u1", email: "a@example.com", name: "A", role: "developer" }];

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
