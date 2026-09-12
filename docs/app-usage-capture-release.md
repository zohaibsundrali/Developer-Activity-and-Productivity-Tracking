# App usage follows captured time and cumulative updates

The monitoring page filtered app usage by `tracked_at`, which the target schema defaults to upload time. Tracker ingestion records the capture interval in `start_time/end_time`, and retention authorization uses `start_time`. Delayed uploads could therefore appear under their upload day instead of the captured period. The app query now uses the captured start time with inclusive/exclusive UTC boundaries, retaining the existing start-day attribution of each aggregate (it does not invent a distribution across days).

App reads page through every authorized result using stable start-time/id ordering and exact counts. Lower provider row limits no longer silently truncate the former 1,000-row list. Changing counts, duplicates, missing/foreign rows and malformed durations fail visibly. Numeric durations are normalized before summing; a missing duration unit is derived from the other valid unit. The displayed top-app/timeline subsets remain labelled presentation limits.

Cumulative tracker uploads update existing aggregates. Both INSERT and UPDATE now request a debounced authoritative refresh rather than adding payload durations or ignoring revisions. Requests are coalesced and subscription-triggered refreshes are serialized; events arriving during a refresh schedule another pass. Typed caller/organization/selection guards remain active, and disposal cancels pending followups. The current request clears the loader even if a silent refresh supersedes an initial request.

## Rollout and verification

Merge PR #125 and preceding dependencies, then deploy this web release. No new SQL migration or desktop rebuild. Existing tracking-ingestion and retention migrations remain prerequisites. Check delayed app uploads, revised durations, switching accounts during loading, and denied monitoring access after deployment.

The full regression passed 4,650 of 4,651 tests; the remaining static import scanner misread an object method as an unimported function. Making the local method declaration explicit resolved it, and both affected test files passed all 10 tests. All 4,651 cases are covered by passing runs across 227 files. Production build passed; existing lint warnings remain.

No production customer records were changed; only OpenAPI schema metadata was inspected. Multiple page requests are not a transactionally frozen snapshot against same-count edits. Large authorized histories still incur browser/network costs. Existing session/screenshot/login limits, a website-usage viewing surface, and live desktop/provider verification remain separate work.
