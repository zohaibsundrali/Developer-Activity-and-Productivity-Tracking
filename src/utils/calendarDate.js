/** Strict calendar date for date-only database columns; rejects JS rollover dates. */
export function isCalendarDate(value) {
  if (typeof value !== "string" || (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-"))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function invalidOptionalDate(body, fields) {
  return fields.find(field => body?.[field] !== undefined && body[field] !== null
    && body[field] !== "" && !isCalendarDate(body[field]));
}
