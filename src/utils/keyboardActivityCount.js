/** Canonical keyboard-stats wire field; malformed data is unavailable, not zero. */
export function keyboardActivityCount(report) {
  if (!Array.isArray(report?.data)) return null;
  let total = 0;
  for (const row of report.data) {
    const raw = row?.total_keys;
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+$/.test(raw))) return null;
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(total + count)) return null;
    total += count;
  }
  return total;
}
