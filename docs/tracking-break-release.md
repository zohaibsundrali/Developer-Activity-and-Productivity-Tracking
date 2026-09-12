# Recorded break history

Pause opens a break; Resume or Stop closes it. Break seconds are measured by a monotonic clock and excluded from the existing tracked-time timer. This release does not classify breaks as paid/unpaid or automatically deduct idle time.

The session checkpoint contains stable break UUIDs, UTC device timestamps, measured duration for closed breaks, and the closed-break total. At most one final interval may be open. Pause/resume checkpoints use the existing identity-scoped durable session queue. A restarted process replays an open checkpoint unchanged; it never guesses an end time or counts time while the app was not running.

## Rollout

Apply pending project/task tracking migration `20260912075706_production_tracking_work_context.sql` first if needed. Then run the entire `supabase/migrations/20260912081724_production_tracking_break_history.sql` once. Deploy web, rebuild/install desktop, and test on a staging Windows machine before wider rollout.

Web session detail lists the latest50 intervals with the total for all closed breaks. Open history is labelled end not recorded; it does not falsely claim the employee is currently on break. The desktop shows live break count/duration, retained after stopping. Historical rows without recorded pauses are not evidence of no breaks.

## Database contract

Typed device and organization RLS remain in force. Break history validates UUIDs, explicit-zone finite timestamps, nonnegative numeric durations, exact fields, total consistency, unique IDs, an open interval only at the end, and a maximum10000 intervals per session. Closed intervals are immutable and history cannot be removed. A completed session cannot gain or change breaks. Exact checkpoint replays remain supported.

Wall-clock order is not a duration source: a device clock adjustment can make an end timestamp precede its start. Measured duration is retained, not recomputed from timestamps. Client telemetry is not trusted payroll evidence. No timesheet approvals or invoice values are changed.

## Staging verification

Start, Pause, Resume twice, then Stop while paused. Confirm no paused time entered tracked duration, one interval per successful pause, completed durations in history, and safe repeat-click behavior. Repeat with offline transitions and a process interruption during pause, then same-account restart. Confirm an unfinished interval remains visibly unfinished. Verify another user/tenant cannot edit the session or submit its breaks. A revoked device must not upload queued history. Check clock-change behavior and installer imports on Windows.
