# Report completeness and UTC date boundaries

Report paging now follows the rows actually returned by the provider rather than assuming every response uses the requested page size. It validates row identities, stable ordering and complete counts, and detects duplicate/changing pages. Report roster reads are also paged, so a small hosted row cap no longer drops members and their tracking sessions. Only reporting display identities are loaded; rich HR profiles are not included.

Desktop sessions have a stable session-ID tie-breaker and are deduplicated across ID/email lookups within a global row budget. Report API responses reject any truncated input instead of publishing partial totals. Headline status counts derive from the same complete task rows as project/team tables, avoiding contradictory totals from separate count queries. The existing operational row ceilings remain: 5,000 projects, 20,000 tasks/time logs/roster source rows and 10,000 desktop sessions. Larger datasets require narrower time ranges where applicable or a future server aggregation workflow. These are processing bounds, not subscription entitlements.

Date controls and chart buckets consistently use UTC calendar dates. The exclusive start of the following day includes all fractional seconds of the selected final day. Leap days and daylight-saving transitions no longer shift chart labels. Invalid dates and ranges longer than 3,660 days are rejected before report work; that bound protects chart computation and does not grant history access. Existing plan and caller-JWT RLS history/monitoring restrictions remain in force.

Refresh, date changes and identity changes invalidate the previously loaded bundle immediately. Failures show an inline retry state; an empty successful report is a distinct state. CSV/PDF exports require current successfully loaded data, and a pending lazy PDF export cancels when its page or scope is no longer current. API responses are private and uncacheable, and internal database errors are not exposed.

## Rollout and verification

Merge/deploy the web PR. No new SQL migration or desktop rebuild is needed. Verify date edges, a multi-page team, denied report access, failed refresh, account switching and CSV/PDF exports with live test accounts.

This is not a transactionally frozen snapshot across every HTTP query: same-count concurrent edits can still occur during a report load. Detected count/identity conflicts fail instead of producing a report; a future database snapshot/aggregation workflow is needed for stronger snapshot guarantees at larger scale. Live hosted journeys and prior identity recovery remain separate verification work.

Validation: 4,322 tests passed across 212 files, and the production build passed. Targeted tests cover low hosted caps, exact/overflow ceilings, changing counts, typed rosters, UTC/DST/leap boundaries, partial-bundle rejection, permission/plan failures and stale/cancelled exports. No database schema changes in this release. These local checks do not certify live production journeys.
