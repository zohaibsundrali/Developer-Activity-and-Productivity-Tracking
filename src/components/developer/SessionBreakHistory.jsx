'use client';
import { sessionBreakSummary, breakDuration } from '@/utils/sessionBreaks';

export default function SessionBreakHistory({ session }) {
  const summary = sessionBreakSummary(session);
  return <section className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5" aria-label="Recorded breaks">
    <h2 className="font-semibold">Recorded breaks</h2>
    {!summary.available ? <p className="mt-2 text-sm text-muted-foreground">Break history is unavailable for this session.</p>
      : !summary.periods.length ? <p className="mt-2 text-sm text-muted-foreground">No breaks recorded.</p> : <>
        <p className="mt-2 text-sm">{summary.periods.length} breaks · {breakDuration(summary.seconds)} closed-break time, excluded from tracked time.</p>
        {summary.open && <p className="mt-2 text-sm text-muted-foreground">A break has no recorded end. The tracker may still be paused, offline or interrupted; its final duration is not yet known.</p>}
        <ol className="mt-3 space-y-2 text-sm">
          {summary.periods.slice(-50).map(period => <li key={period.id} className="border-t border-border pt-2">
            <time dateTime={period.started_at}>{new Date(period.started_at).toLocaleString()}</time>
            {' → '}{period.ended_at ? <time dateTime={period.ended_at}>{new Date(period.ended_at).toLocaleString()}</time> : 'End not recorded'}
            {period.ended_at && <span> · {breakDuration(period.duration_seconds)}</span>}
          </li>)}
        </ol>
        {summary.periods.length > 50 && <p className="mt-2 text-sm text-muted-foreground">Showing the last 50 recorded breaks. The total includes all recorded closed breaks.</p>}
      </>}
  </section>;
}
