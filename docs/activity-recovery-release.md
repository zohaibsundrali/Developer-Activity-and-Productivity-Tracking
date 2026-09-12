# Durable app and website aggregates

The desktop previously inserted closed app segments separately from live upserts, while failed app/site snapshots lived only in memory. The new path aggregates every segment of one app within the tracking session and queues cumulative app/site snapshots before network delivery. Stable keys and revision receipts prevent duplicate retry records and stale overwrites.

Actual hosted OpenAPI app_usage/browser_usage columns were inspected read-only before implementation. No production rows were read or modified. Existing historical rows are preserved; old clients remain supported for rows without a new receipt. Once a row has a receipt, unversioned overwrites cannot erase it.

## Rollout

1. Run `scripts/sql/activity-aggregate-preflight.sql` read-only first. If it returns rows, review those historical duplicates before migration; do not delete or merge them blindly. No rows means no duplicate non-null aggregate keys were found.
2. Run the complete `supabase/migrations/20260912084740_production_activity_aggregate_receipts.sql` once after existing device/session/permission prerequisites. The uniqueness check can still reject concurrent legacy duplicates; stop and reconcile rather than replaying bundles.
3. Deploy web/database changes, then rebuild/install the coordinated desktop app. Verify on a staging Windows device before wider rollout.

## Behavior and limits

App/site snapshots wait until their own authenticated productivity session is saved and visible. New activity cannot attach to another member's session. Existing RLS/plan/history restrictions still apply. Exact receipt retries acknowledge an already-visible stored aggregate without creating new data.

Capture is sampled and checkpointed; this protects saved snapshots, not every unsaved second before a crash. Current checkpoint cadence follows the 2-second polling loop, with a stop checkpoint. The local queue is identity-scoped and retains unconfirmed/corrupt snapshots for recovery. Acknowledged payload content is compacted to revision/hash/duration metadata. Local storage is not encrypted at rest. Pending payload budget 64 MiB and receipt-key budget 100000 stop further app/site capture on exhaustion rather than deleting pending data.

Pause holds background uploads. Stop saves final in-memory data first and makes one bounded final-row upload attempt under the original login. Other pending records retry with the next active authorized tracker; no activity is reassigned to whoever signs in next. An already-started request cannot be recalled, and its uncertain outcome stays retryable.

The dashboard reports app/site synchronization separately from session summaries and screenshots. Foreground app/site counts remain device telemetry, not payroll approval or an objective measure of work quality. Keyboard/mouse detailed-event offline recovery is separate work.

## Staging checks

Track an app, close/reopen it within one session, and verify one aggregate with cumulative duration. Repeat with a browser site. Disconnect internet, checkpoint, restart with the same account and reconnect; confirm queued records sync after their session checkpoint. Test a lost response and a newer snapshot arriving during retry. Switch accounts, pause, stop and revoke a device; verify identity isolation. Test capacity, malformed/corrupt local snapshots and server permission/plan failures. Check authenticated app/site views and report totals do not double count reopened segments.
