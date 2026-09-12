const DAY_MS = 86400000;
// Computational guard for chart buckets; this is not a subscription limit.
export const MAX_REPORT_DAYS = 3660;

export function validReportDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !value.startsWith("0000-") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Reports use UTC calendar dates, independently of the viewer's timezone. */
export function reportDay(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validReportDate(value) ? value : null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function reportDaysBetween(a, b) {
  const first = reportDay(a);
  const last = reportDay(b);
  return first && last ? (Date.parse(last) - Date.parse(first)) / DAY_MS : 0;
}

export function reportDefaultRange(now = new Date()) {
  const to = reportDay(now);
  if (!to) throw new Error("Invalid report date");
  return { from: reportDay(new Date(Date.parse(to) - 29 * DAY_MS)), to };
}

export function reportRangeBounds(range) {
  if (!validReportDate(range?.from) || !validReportDate(range?.to) || range.from > range.to) {
    throw new Error("Report dates must be valid YYYY-MM-DD values in chronological order.");
  }
  const dayCount = (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS + 1;
  if (dayCount > MAX_REPORT_DAYS) throw new Error(`Report range cannot exceed ${MAX_REPORT_DAYS} days.`);
  if (range.to === "9999-12-31") throw new Error("Report end date must be before 9999-12-31.");
  return {
    fromIso: `${range.from}T00:00:00.000Z`,
    // Exclusive upper bound includes every fractional second of the final day.
    toIso: new Date(Date.parse(range.to) + DAY_MS).toISOString(),
  };
}

export function reportRangeDays(range) {
  const { fromIso, toIso } = reportRangeBounds(range);
  const days = [];
  for (let time = Date.parse(fromIso); time < Date.parse(toIso); time += DAY_MS) days.push(reportDay(new Date(time)));
  return days;
}
