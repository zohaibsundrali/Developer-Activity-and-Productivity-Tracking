# Website usage monitoring

The Windows tracker already uploads website labels/domains and cumulative
observed durations to browser_usage. Monitoring now includes a Website Usage
view with complete selected-period totals, a paginated website list and CSV
export of all loaded records. Website labels are plain text, never executable
links; spreadsheet formula prefixes are escaped by the shared CSV serializer.

Reads use the existing signed-in, RLS-scoped client with explicit organization
and employee filters. First-seen UTC dates determine period membership, so offline
uploads stay with their captured period. Exact counts, stable ordering, duplicate
checks and actual returned page lengths protect against truncated provider pages.
A final count check detects count drift. This is not a transactional snapshot:
same-count concurrent revisions can still require a refresh.

INSERT/UPDATE events trigger a coalesced authoritative refresh. A visible-page
30-second poll and focus refresh cover retention/deletion or missing realtime
publication. Requests time out, clear failed totals and expose Retry. Identity,
permission or selected scope changes invalidate pending callbacks and exports;
rows from a previous binding are never rendered while a new request starts.

These are observed browser durations, not additional tracked hours, payroll
amounts, complete browser history or proof of productivity. Unrecognized pages
may appear as Other website. Empty results are not proof that no browser was used.

No new migration or desktop build is required for this view. Existing typed
monitoring policies and activity-aggregate migrations must already be installed.
Verify actual employee browser capture, delayed uploads, permission denial and
a second organization's isolation using the installed tracker before rollout.
