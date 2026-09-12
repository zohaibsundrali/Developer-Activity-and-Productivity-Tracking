import { describe, it, expect } from "vitest";
import { attendanceActionRequest, priorAttendanceCheckout } from "../src/utils/attendanceActions";
const open = { id: "shift", work_date: "2026-09-11", check_in_at: "2026-09-11T23:50:00Z", check_out_at: null };
describe("overnight attendance checkout", () => {
  it("closes yesterday's loaded open shift using its original work date", () => {
    expect(attendanceActionRequest("check_out", "2026-09-12", "2026-09-12", open)).toEqual({ action: "check_out", workDate: "2026-09-11" });
  });
  it("does not expose completed or never started historical shifts", () => {
    expect(priorAttendanceCheckout({ ...open, check_out_at: "2026-09-12T06:00:00Z" }, "2026-09-12")).toBeNull();
    expect(priorAttendanceCheckout({ ...open, check_in_at: null }, "2026-09-12")).toBeNull();
  });
  it("refuses a stale midnight today action until the date refreshes", () => {
    expect(attendanceActionRequest("check_in", "2026-09-11", "2026-09-12")).toBeNull();
    expect(attendanceActionRequest("check_in", "2026-09-12", "2026-09-12")).toEqual({ action: "check_in", workDate: "2026-09-12" });
  });
  it("cannot start a new historical shift through the history action", () => {
    expect(attendanceActionRequest("check_in", "2026-09-12", "2026-09-12", open)).toBeNull();
  });
  it("keeps today's shift on the normal action and does not guess a maximum shift length", () => {
    expect(priorAttendanceCheckout(open, "2026-09-11")).toBeNull();
    expect(priorAttendanceCheckout(open, "2026-09-20")).toEqual({ action: "check_out", workDate: "2026-09-11" });
  });
});
