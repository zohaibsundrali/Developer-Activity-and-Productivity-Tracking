# Screenshot recovery rollout

The desktop previously lost image bytes on failed uploads, and Storage could succeed while metadata failed. The web ingest route also omitted required screenshot columns verified against the hosted OpenAPI schema (developer email, dimensions, size and MIME type). This release adds durable desktop recovery and an authenticated, idempotent database finalizer, and fixes the web route's metadata.

## Deploy in order

1. Apply the complete `supabase/migrations/20260912070957_production_idempotent_screenshot_capture.sql` once in the target Supabase SQL Editor. Do not replay earlier migration bundles. Stop if it fails and inspect the error before proceeding.
2. Deploy this web change after that migration. Existing desktop direct inserts remain supported; the new finalizer requires current device/profile authority and existing RLS/quota prerequisites.
3. Merge the coordinated `desktopTracker` screenshot-recovery PR, rebuild the desktop installer and install it on a staging Windows device before wider rollout.
4. Verify capture, pause/stop, offline capture, reconnect, same-account restart and revoked-device behavior. Confirm one metadata row/private object for each supplied capture ID, including a lost response retry. Check an expired plan/count limit/storage limit and current screenshot access rules. No real screenshots or hosted writes were used in offline tests.

There is one new migration in this release. It adds nullable capture receipt fields, a unique organization/capture index, an argument-free authenticated quota-lock helper, an RLS-bound finalizer and an immutable-receipt trigger. It does not backfill or rewrite historical screenshot records. Later annotation edits remain allowed by existing authorization.

## Contract and limits

Production web ingest accepts an optional UUID `capture_id`; clients that retry must keep that ID, timestamp and original content/metadata. A new ID represents a new capture. Old clients that never supply an ID cannot receive an exactly-once guarantee across disconnected requests. The web path remains PNG-only; the desktop direct Storage path supports PNG and JPEG. Both use a 6 MiB image ceiling and maximum dimension of 16,384 pixels.

Uploads never overwrite an existing object. A duplicate/ambiguous Storage result requires the original bytes to match before finalization. The finalizer validates current identity/device, private path, visible object presence/size and metadata, then reuses an exact receipt without a second quota-charged INSERT. Different metadata with the same capture ID is refused. A replay with a missing visible object is not acknowledged.

Storage and metadata are separate transactions. A metadata quota failure can leave an owned pending object; existing Storage byte accounting still applies. The durable desktop record allows recovery. There is no new pre-upload screenshot-count reservation or automatic orphan deletion in this release. Retention and policy changes can require operator review of pending captures. Client capture timestamps are not proof of a trusted clock; server-created receipt/object times remain separate.

The new UI reports screenshot synchronization separately from session-summary synchronization. Pause/stop/logout guards prevent later capture/upload phases; an already-started remote request cannot be recalled. Existing screenshot policy is preserved. Organization-controlled disable/blur settings versus employee self-service controls still need the requested policy choice and are not claimed complete here.

## Verification

The new fixture is included in `scripts/test-audit-policies.sh`. It exercises actual migration functions, device/RLS/quota checks, immutable/direct-insert receipts, missing objects and four concurrent finalizations. The desktop uses local SQLite, fake encoders and HTTP interception in tests. Windows locking/installer behavior and actual Supabase Storage requests remain deployment checks.

Final validation: 189 web test files / 3,961 tests passed; production build passed with existing lint warnings. The complete isolated PostgreSQL regression suite passed, including the new four-way screenshot finalization race. The coordinated desktop suite passed 77 tests. No hosted capture/upload was performed.
