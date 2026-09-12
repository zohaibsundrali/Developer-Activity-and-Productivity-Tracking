# Live device presence

The monitoring dashboard now shows current device heartbeats independently of historical activity. Historical `active`, `periodic`, checkpoint end times and offline uploads no longer establish that somebody is currently tracking. Session summaries describe the latest recorded session in the selected date range.

The updated desktop sends its current `tracking`, `paused` or `idle` timer state immediately on transitions and every 30 seconds while signed in. Paused timers continue sending presence. A heartbeat indicates a connected tracker, not productivity or keyboard/mouse activity. There is no productivity-session binding in this release.

The database timestamps receipts and binds writes to the authenticated, enrolled, unrevoked, unexpired device and active typed developer membership. Its Auth session must still exist. Stream initialization uses a compare-and-swap epoch and idempotent nonce; monotonically increasing sequence numbers fence delayed requests. Failed heartbeat samples are never stored in the activity outbox. A superseded stream stops reporting until a fresh login.

The dashboard uses server time plus elapsed monotonic time. Devices become disconnected after 90 seconds without a receipt; expired, revoked and never-seen devices remain distinct. Read failures display unavailable status. Polling runs every 10 seconds while visible, refreshes on focus, and times out after 15 seconds. Multiple devices are shown individually; at most 100 device records are returned, with a complete count and explicit truncation notice.

## Deployment order

1. Ensure PR #129 and its screenshot metadata migration are already deployed.
2. In the correct Supabase project (`isaccqqjobuwfeaxlrwc`), run **only** `supabase/migrations/20260912154948_production_tracker_device_presence.sql` for this release. Run the complete file once. Do not replay old migration bundles.
3. Merge/deploy the web presence PR.
4. Merge the companion `zohaibsundrali/desktopTracker` presence PR. Build and distribute the updated desktop application using that repository's `BUILD_EXE.md` on the supported operating system. Sign out of the old application, close it, install the update, and sign in again.

The migration is additive and does not backfill online status from old activity. Old desktop versions still record activity but cannot supply presence; the dashboard will show no live heartbeat. Missing presence RPCs do not stop the updated desktop's existing tracking functionality.

## Verification

- On an authorized monitoring account, select the developer and confirm a newly signed-in updated desktop shows `Connected · timer stopped`.
- Start, pause, resume and stop tracking. Allow one 10-second dashboard poll after the desktop request completes. Check the matching device state; historical totals must remain available.
- Disconnect the desktop network or close its process. After 90 seconds without a heartbeat, confirm disconnected status. Reconnect and check recovery from the current state, without replaying old heartbeat states.
- Revoke the device or sign out. Confirm it cannot refresh presence. A failed offline logout may remain visible until the 90-second freshness window expires.
- Verify an account without effective wide `monitoring.view` access, a client, and a different organization cannot call the monitoring RPC successfully. Confirm multiple devices retain separate statuses.

Automated validation covers local SQL permissions, device lifecycle and stream ordering, desktop state transitions and failure recovery, dashboard freshness, timeout and stale-scope protection. Hosted Auth, real network transitions, packaged Windows/macOS execution and browser rendering still require the production checks above. This release does not certify every integration or complete all Hubstaff features.
