import { describe, it, expect, vi } from "vitest";
import { loadAttendanceRange, validateAttendanceReceipt, attendanceIdentity } from "../src/utils/attendanceRequests";
const context = { organizationId: "org", userId: "profile", userType: "admin" };
const range = { context, from: "2026-09-01", to: "2026-09-12" };
const row = { id: "00000000-0000-4000-8000-000000000001", organization_id: "org", user_id: "profile", user_type: "admin", work_date: "2026-09-12" };
const response = (records, nextCursor = null) => ({ ok: true, json: async () => ({ success: true, records, nextCursor, hasMore: !!nextCursor }) });
describe("attendance complete range loading", () => {
  it("follows actual server cursor pages before returning stats input", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([row], "next+cursor")).mockResolvedValueOnce(response([{ ...row, id: "00000000-0000-4000-8000-000000000002", work_date: "2026-09-11" }]));
    expect(await loadAttendanceRange(fetcher, range)).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toContain("cursor=next%2Bcursor");
  });
  it("rejects a later page failure instead of returning partial totals", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([row], "next")).mockRejectedValueOnce(new Error("offline"));
    await expect(loadAttendanceRange(fetcher, range)).rejects.toThrow("offline");
  });
  it("rejects repeated records from changing pagination", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([row], "next")).mockResolvedValueOnce(response([row]));
    await expect(loadAttendanceRange(fetcher, range)).rejects.toThrow("changed");
  });
  it("discards an old identity response and does not fetch its next page", async () => {
    let active = true;
    const fetcher = vi.fn(async () => { active = false; return response([row], "next"); });
    expect(await loadAttendanceRange(fetcher, { ...range, current: () => active })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ user_type: "developer" }, { organization_id: "another" }, { work_date: "2026-09-32" }, { id: "invalid" }])("rejects unscoped or invalid list rows %j", async (patch) => {
    await expect(loadAttendanceRange(async () => response([{ ...row, ...patch }]), range)).rejects.toThrow("changed");
  });
  it.each([undefined, null, "", "   ", false, 0])("rejects hasMore without a usable cursor %j", async nextCursor => {
    const fetcher = async () => ({ ok: true, json: async () => ({ success: true, records: [row], hasMore: true, nextCursor }) });
    await expect(loadAttendanceRange(fetcher, range)).rejects.toThrow("complete");
  });
});
describe("attendance mutation acknowledgement", () => {
  const context = { organizationId: "org", userId: "profile", userType: "admin" };
  const receipt = { success: true, unchanged: false, record: { ...row, organization_id: "org", user_id: "profile", user_type: "admin", check_in_at: "2026-09-12T09:00:00Z" } };
  it("accepts a scoped confirmed check in", () => {
    expect(validateAttendanceReceipt(receipt, context, row.work_date, "check_in")).toEqual(receipt.record);
  });
  it.each([{ user_type: "developer" }, { organization_id: "other" }, { user_id: "other" }, { work_date: "2026-09-11" }])("rejects a mismatched receipt %j", (patch) => {
    expect(() => validateAttendanceReceipt({ ...receipt, record: { ...receipt.record, ...patch } }, context, row.work_date, "check_in")).toThrow("confirm");
  });
  it("requires a completed checkout and explicit unchanged flag", () => {
    expect(() => validateAttendanceReceipt(receipt, context, row.work_date, "check_out")).toThrow();
    expect(() => validateAttendanceReceipt({ ...receipt, unchanged: undefined }, context, row.work_date, "check_in")).toThrow();
  });
  it("accepts an unchanged nonworking day without claiming a check in", () => {
    const unchanged = { ...receipt, unchanged: true, record: { ...receipt.record, status: "holiday", check_in_at: null } };
    expect(validateAttendanceReceipt(unchanged, context, row.work_date, "check_in").status).toBe("holiday");
  });
  it("keeps colliding admin and developer identities distinct", () => {
    expect(attendanceIdentity(context)).not.toBe(attendanceIdentity({ ...context, userType: "developer" }));
  });
});
