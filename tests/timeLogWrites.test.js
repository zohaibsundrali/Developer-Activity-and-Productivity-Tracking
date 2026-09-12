import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ ctx: {}, responses: [], calls: [], inserts: [] }));
vi.mock("@/utils/orgContext", () => ({ getOrgId: () => state.ctx.organizationId, getOrgContext: () => state.ctx }));
vi.mock("@/utils/authFetch", () => ({ authFetch: vi.fn() }));
vi.mock("@/utils/supabaseClient", () => ({ supabase: { from(table) {
  const result = table === "pm_activity" ? { data: null, error: null } : state.responses.shift();
  const q = { then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
  for (const method of ["select", "insert", "update", "eq", "is", "order", "limit", "single", "maybeSingle"]) q[method] = (...args) => {
    state.calls.push([table, method, ...args]);
    if (method === "insert") state.inserts.push([table, args[0]]);
    return q;
  };
  return q;
} } }));
import { addManualTimeLog, getActiveTimer, startTaskTimer, stopTaskTimer } from "@/utils/pmData";
const entry = { taskId: "task-1", projectId: "project-1", seconds: 60, note: "Completed review" };
const row = () => ({ id: "log-1", task_id: entry.taskId, organization_id: "org-1", developer_id: "staff-1", user_type: state.ctx.userType, seconds: 60 });
beforeEach(() => { state.ctx = { organizationId: "org-1", userId: "staff-1", userType: "developer" }; state.responses = []; state.calls = []; state.inserts = []; });
describe("typed time-log writes require confirmed mutations", () => {
  it.each(["admin", "developer"])("persists the exact %s identity and duration", async userType => {
    state.ctx.userType = userType; state.responses.push({ data: row(), error: null });
    const result = await addManualTimeLog(entry);
    expect(result.error).toBeNull(); expect(result.log.id).toBe("log-1");
    expect(state.inserts[0][1]).toMatchObject({ developer_id: "staff-1", user_type: userType, seconds: 60, organization_id: "org-1" });
    const saved = state.inserts[0][1];
    expect(Date.parse(saved.ended_at) - Date.parse(saved.started_at)).toBe(60000);
  });
  it.each([null, "client", "owner"])("rejects untyped/nonstaff identity %s before database access", async userType => {
    state.ctx.userType = userType;
    expect((await addManualTimeLog(entry)).error).toBeTruthy(); expect(state.calls).toEqual([]);
  });
  it.each([0, -1, NaN, Infinity, 0.5, 2147483648, "bad", null, true])("rejects invalid seconds %s before inserting", async seconds => {
    expect((await addManualTimeLog({ ...entry, seconds })).error).toBeTruthy(); expect(state.calls).toEqual([]);
  });
  it.each([null, { id: "foreign", seconds: 60 }, { ...row(), user_type: "client" }])("does not report an unconfirmed/foreign insertion as success", async data => {
    state.responses.push({ data, error: null });
    const result = await addManualTimeLog(entry); expect(result.log).toBeNull(); expect(result.error.message).toContain("not confirmed");
  });
  it("returns database rejection without a success row", async () => {
    const error = new Error("TIMESHEET_LOCKED"); state.responses.push({ data: null, error });
    expect(await addManualTimeLog(entry)).toEqual({ log: null, error });
  });
  it("fails closed if the active timer cannot be read", async () => {
    state.responses.push({ data: null, error: new Error("offline") });
    await expect(startTaskTimer("task-1", "project-1")).rejects.toThrow("confirm the active timer");
    expect(state.inserts).toEqual([]);
  });
  it("scopes active timer reads by both profile and type", async () => {
    state.ctx.userType = "admin"; state.responses.push({ data: [], error: null });
    await getActiveTimer();
    expect(state.calls).toContainEqual(["task_time_logs", "eq", "developer_id", "staff-1"]);
    expect(state.calls).toContainEqual(["task_time_logs", "eq", "user_type", "admin"]);
  });
  it("does not start a replacement timer when stopping the old row affected nothing", async () => {
    state.responses.push({ data: [{ id: "old", task_id: "other", started_at: new Date().toISOString() }], error: null }, { data: null, error: null });
    const result = await startTaskTimer("task-1", "project-1");
    expect(result.error.message).toContain("not confirmed"); expect(state.inserts).toEqual([]);
  });
  it("a denied/no-row stop is not logged as successful activity", async () => {
    state.responses.push({ data: null, error: null });
    const result = await stopTaskTimer({ id: "log-1", started_at: new Date().toISOString() });
    expect(result.error).toBeTruthy(); expect(result.seconds).toBeUndefined(); expect(state.inserts).toEqual([]);
    expect(state.calls).toContainEqual(["task_time_logs", "eq", "user_type", "developer"]);
    expect(state.calls).toContainEqual(["task_time_logs", "is", "ended_at", null]);
  });
});
