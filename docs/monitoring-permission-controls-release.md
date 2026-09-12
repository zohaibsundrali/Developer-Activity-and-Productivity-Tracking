# Monitoring controls respect the authenticated permission

Staff with an explicit `monitoring.view` grant could reach the monitoring page and load its authorized roster, but its selector and Refresh still depended on a separate `sessionStorage.adminUser` record. Developer-typed staff have a different legacy storage record, so the page incorrectly asked them to log in and disabled selection.

The page now relies on its existing authenticated typed identity and effective `monitoring.view` guard for these controls. Refresh reloads the authorized roster. The roster caption describes available developers, and the empty state links to Employees only when `member.view` is allowed; it no longer claims only admins can monitor or promises account creation to a viewer.

This does not grant monitoring to all staff or broaden backend access. Existing RLS applies organization, active membership, explicit monitoring overrides, own-record rules and retention constraints. No SQL migration or desktop rebuild is required.

Merge PR #124 and its preceding dependencies first, then deploy this web release. Validate a permitted staff account with an explicit monitoring grant, a denied administrator, and an ordinary staff account with own-activity access only. Hosted browser/realtime and desktop behavior still require deployment verification.

Validation: all 4,606 tests across 225 files and the production build passed. Existing repository lint warnings remain.
