export function sessionBreakSummary(session) {
  const periods = session?.break_periods;
  if (periods == null) return { available: false, periods: [], seconds: 0, open: false };
  if (!Array.isArray(periods) || typeof session.break_duration !== 'number' || !Number.isFinite(session.break_duration) || session.break_duration < 0) {
    return { available: false, periods: [], seconds: 0, open: false };
  }
  const valid = periods.every(p => p && typeof p.id === 'string' && Number.isFinite(Date.parse(p.started_at))
    && (p.ended_at === null || Number.isFinite(Date.parse(p.ended_at)))
    && typeof p.duration_seconds === 'number' && Number.isFinite(p.duration_seconds) && p.duration_seconds >= 0);
  return valid ? { available: true, periods, seconds: session.break_duration, open: periods.some(p => p.ended_at === null) }
    : { available: false, periods: [], seconds: 0, open: false };
}

export function breakDuration(seconds) {
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 3600)}h ${Math.floor(rounded % 3600 / 60)}m ${rounded % 60}s`;
}
