# Complete captured-session monitoring totals

Monitoring previously capped both session rows and a separate total-duration query at 500. The two queries also used different identity filters, and the fallback could place an old captured session in its upload day. The page now uses one complete authorized session list for both timeline and totals.

The loader scopes every query to the organization and the selected profile's authoritative `user_id`. A separate legacy email lookup includes only rows whose `user_id` is null; a contradictory populated ID cannot be overridden by email. Exact-count pagination fills lower provider caps with stable `start_time, session_id` ordering and detects corrupt/inconsistent receipts. `session_id` is the actual primary key; this table has no `id` column.

Each session's recorded seconds are attributed to its captured start-date period, consistently with existing reports. Upload time is not a fallback. Sessions with no capture start are not assigned an invented date. No duration is reconstructed from wall-clock endpoints, so breaks are not added back or midnight time artificially prorated.

Missing numeric durations/scores remain unknown. A total with a missing constituent duration displays Unavailable rather than a partial sum or zero; a confirmed empty dataset totals zero. Numeric strings are normalized, malformed values fail visibly, and missing timeline scores/durations display Unavailable. The summary label now describes the selected period rather than always saying Today.

## Screenshot signing privacy

Review found that monitoring could revive a stale legacy image URL after private signing failed. Resolved private screenshots now clear legacy URL aliases, and initial/realtime consumers use only the resolver public_url. A denied private image cannot fall back to its old URL. Successful signed images and legitimate legacy public rows remain supported.

## Rollout

Merge PR #126 and its preceding dependencies, then deploy this web release. No new SQL migration or desktop rebuild. After deployment, verify more than 500 sessions, a delayed upload, a legacy null-ID row, a conflicting ID/email row, denied monitoring and a second organization with disposable test identities.

All 4,693 tests passed across 228 files on the final combined changes. Production build passed; existing repository lint warnings remain. Session loader and screenshot denial regression tests passed.

No customer records were changed. Multi-query reads are not a transactionally frozen snapshot, and large histories incur browser/network costs. Existing screenshot/login caps, website-usage viewing, legacy identity recovery and hosted desktop/realtime verification remain separate work. Modern periodic/paused session liveness needs its own freshness contract; this release does not label every periodic row currently online.
