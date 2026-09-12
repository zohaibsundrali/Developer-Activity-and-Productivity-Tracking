# Monitoring view identity, dates and live updates

Monitoring now treats an empty or invalid date as validation failure, rather than silently producing a 1900 range. Invalid windows stop activity reads and subscriptions, reset loading states and hide old results while keeping date controls available. Valid today/week/month windows retain UTC calendar boundaries.

The view subscribes to current authentication state and scopes roster, polling and page results to the typed caller as well as the organization and selected developer. Old results are hidden immediately when that scope changes. Mouse, app, screenshot and login realtime callbacks have disposal/identity/permission guards, including deferred state updates and screenshot signing completion.

Mouse events request a debounced authoritative page/count refresh instead of incrementing an estimate that might already include the event. Mouse pages are filled across lower provider row caps with stable ordering and verified exact counts. Repeated app events are deduplicated.

The developer roster now selects only `id, name, email`, and pages through the complete authorized list. The prior wildcard selected unnecessary fields including a legacy password column. The target's read-only OpenAPI schema confirmed the minimal columns; no customer records or credential values were read. This change does not remove legacy database credential columns or certify their broader access policies.

## Rollout

Merge the preceding keyboard release PR #123 first if pending, then merge/deploy this web release. **No new SQL migration or desktop rebuild is required.** Prior releases' SQL prerequisites still apply.

After deployment, clear/reselect the date, switch developers/accounts during loading, close the view while screenshots are signing, and check mouse count/page refresh while events arrive. Verify denied monitoring access and a second organization with disposable identities.

## Verification boundaries

Validation covered all 4,602 tests across 224 files: the initial full run passed 4,601, and the remaining sandbox-blocked generator test passed in its complete 54-test file rerun. The production build passed; existing lint warnings remain. Local tests cover date boundaries, cancelled/foreign scope, minimal complete rosters and paged mouse receipts. Hosted realtime timing and real Windows/macOS capture still need production verification. Existing session/app/screenshot processing ceilings, the non-admin picker restriction for monitoring overrides, and legacy storage/identity recovery remain separate work; this is not an end-to-end production certification.
