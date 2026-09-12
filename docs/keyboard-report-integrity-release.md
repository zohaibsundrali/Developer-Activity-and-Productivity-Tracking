# Keyboard activity counts and report integrity

My Activity now reads the API's canonical `total_keys` field. Missing or invalid values show an unavailable activity panel rather than a false zero. Legitimate empty reports, zero activity and explicitly partial reports remain distinct.

Keyboard report pages must keep the same authorized total, unique record identities and valid page sizes. A changed, duplicate, oversized or unexpectedly empty page fails the report instead of returning misleading complete totals. The existing 20-page/10,000-row bound remains visible as partial coverage; narrow the selected range for larger periods.

When a UUID target is supplied, email fallback is limited to legacy rows without a developer ID. A contradictory explicit developer ID no longer matches through a reused email. Explicit email-only searches retain their existing behavior.

Date windows are half-open: start is inclusive and end is exclusive, matching the monitoring dashboard. Invalid calendar dates are refused. Responses are private/noncached and internal exceptions are sanitized.

Keyboard realtime delivery is checked against the active selection, caller identity, organization, permission and date window, including callbacks queued before a channel is removed.

## Rollout

PRs #121 and #122 are merged. Ensure their respective migrations are installed if still pending, then merge and deploy this web release. **No new SQL migration or desktop rebuild is needed for this keyboard change.**

Verify known nonzero keyboard records in My Activity, an empty period and a period crossing midnight. Switch monitored developers while events arrive and check that old-selection events do not appear in the new view. Exercise monitoring denials and a second organization with disposable test identities.

The bounded report is not a transactionally frozen snapshot: stable-count edits across separate reads can still change values. Local regression does not certify hosted realtime delivery or real desktop keyboard capture. No production customer records were changed.
