/** An existing open shift retains its original work date across midnight. */
export function priorAttendanceCheckout(record, today) {
  if (!record?.id || !record.work_date || record.work_date >= today
    || !record.check_in_at || record.check_out_at) return null;
  return { action: "check_out", workDate: record.work_date };
}

export function attendanceActionRequest(action, displayedToday, actualToday, record = null) {
  if (displayedToday !== actualToday) return null;
  if (record) return action === "check_out" ? priorAttendanceCheckout(record, actualToday) : null;
  if (action !== "check_in" && action !== "check_out") return null;
  return { action, workDate: actualToday };
}
