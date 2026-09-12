# Complete timesheet review lists

The approval API previously stopped after 300 weeks without indicating that more existed. Approval lists now request 50 rows at a time and provide Load more, with a count marked `+` when additional weeks remain. The API preserves its default maximum page of 300 for existing callers.

Pages use descending week and UUID order. Cursors are validated and bound to the current organization, typed caller, scope, status and week filter. Every page and continuation probe uses the caller's database client and existing row permissions. An explicit probe detects further rows even when the hosted database cap is smaller than the requested page. Failed probes return an error rather than falsely declaring a complete list.

Failed continuation requests retain the visible list and the same retry cursor. Refresh, tab/account changes, and unmount invalidate old responses. Pending decisions are tied to the current view/identity and duplicate confirmation requests are suppressed.

Deploy after PR #115 and its two SQL migrations. This release adds no SQL migration and needs no desktop rebuild. PR #115 is confirmed merged. A read-only production OpenAPI check on 12 September confirmed submit_timesheet_week, decide_timesheet, task_time_logs.user_type and timesheets.decided_by_type are visible. This establishes object presence, not a full migration-body, privilege or live-flow audit. Validate awaiting/approved/rejected lists with a real authorized account after deployment; local tests do not establish that production migrations or role configuration are correct.

## Notification failure recovery

Single mark-read/dismiss actions also restore their unread badge contribution if the write fails and no newer authoritative count has superseded it. This covers offline failures where the reconciliation count request fails too. Independent failed actions restore independently; newer server counts and identity changes are protected, and repeated actions on the same notification are suppressed while pending. Bulk actions wait for existing single actions, and later single actions wait for bulk completion, so their optimistic count baselines cannot conflict. Independent single actions still run concurrently. Identity changes start a fresh queue and invalidate old queued work.

## Validation

4,131 web tests passed across 202 files. Coverage includes 321-week pagination, hosted short pages, cursor/filter/identity validation, page retry and stale responses, failed notification mutations/count requests, concurrent single failures, both bulk/single operation orders and queue reset on identity change. No database policies or schemas change in this release; production role and browser workflows still need deployed-account verification.
