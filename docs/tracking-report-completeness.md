# Tracking report coverage and event-time history

Keyboard reports previously used one database request, so the provider's row limit could silently omit older windows from a selected period. The API now reads bounded pages with authorized exact counts and deterministic timestamp/ID ordering. It advances by the number of returned records, including deployments with a lower server row cap. A failed page fails the report rather than returning a success with missing data. Requests are bounded to 20 pages and 10,000 records; both report views label incomplete data and loaded record counts explicitly. Reports read live pages, not a transactionally frozen snapshot.

Device management now offers Load more using a timestamp/UUID cursor. A one-row continuation probe detects more data even when the server returns a short page. Refresh, auth changes and unmount cancel stale page results. Revocation keeps its existing RLS and authorized RPC.

The migration uses app start_time and browser first_seen for subscription history access. Uploading older activity no longer makes it appear newly recorded. Other signal timestamp behavior and legacy fallback remain intact. Browser retention uses last_seen, preserves open/malformed intervals, and retains existing opt-in and foreign-key safety rules.

## Rollout

Apply `supabase/migrations/20260912094423_production_tracking_event_history_timestamps.sql` once and deploy this web change. The migration performs no data deletion and does not enable cleanup. Organizations that already enabled automatic retention will subsequently age browser records by their captured last_seen rather than upload time; review the configured policy before the next scheduled sweep.

Keyboard report and device pagination require no desktop rebuild. The earlier input recovery desktop/database release remains separate. Hosted role journeys, provider integrations and real Windows capture are not proven by local fixtures.

## Validation

Route tests cover low provider caps, multiple pages, partial-result flags, failed pages, cursor validation, identical timestamps and existing identity restrictions. UI tests cover partial report notices and asynchronous device page recovery. PostgreSQL fixtures exercise actual history RLS across Free, Professional, cancelled and Enterprise access; an actual retention sweep verifies opt-in, old-event removal and open/referenced-record preservation.
