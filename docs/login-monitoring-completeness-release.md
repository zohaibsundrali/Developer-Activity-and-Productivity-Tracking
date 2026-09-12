# Complete developer login history

Monitoring no longer stops at 500 login records or falls back to a date-only query across other developers. Every login read requires the organization and selected developer ID, uses the actual five-column schema, and pages by `login_time, id` with exact-count validation. Lower provider limits do not skip records; changing counts, duplicates, foreign rows and malformed timestamps fail visibly.

The same complete list feeds the login count, chronological table and first/second login summaries. INSERT and UPDATE events request coalesced canonical refreshes instead of appending event payloads, so duplicated notifications and revised timestamps cannot inflate the count or leave moved rows in the old window. Existing typed caller, permission and cleanup guards remain.

The card now names the selected period. UTC filtering and the existing Asia/Karachi display timezone are stated explicitly. Failed monitoring reads hide the zero/empty summary panels and show the existing retry error, rather than presenting unavailable data as a successful empty result.

## Rollout

Merge PR #127 and preceding dependencies, then deploy this web release. No SQL migration or desktop rebuild. Check more than 500 logins, a timestamp correction across the date boundary, denied access and account/developer changes during loading using disposable test identities.

All 4,718 tests passed across 229 files; the production build passed. Targeted login/refresh/rendering checks passed, with only existing repository lint warnings.

Only target OpenAPI schema metadata was read; no customer records were changed. Multi-page reads are not a frozen snapshot against same-count edits, and large histories incur browser/network costs. Screenshot paging/count/signing renewal, website usage viewing, session freshness and hosted browser/desktop verification remain separate work.
