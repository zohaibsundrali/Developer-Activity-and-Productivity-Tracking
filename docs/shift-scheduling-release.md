# Shift scheduling

The shared **Shift schedule** screen is available in staff and admin dashboards.
Employees see their published and cancelled shifts. Attendance managers with both
`attendance.manage` and `attendance.view_all` can search active staff, create drafts,
publish, edit and cancel shifts. The shared entry requires `attendance.view_own`;
it does not admit contributors to the admin area. Existing explicit permission
overrides apply in the API and the database.

Times are entered in an IANA timezone and stored as UTC instants. Missing local
clock times are rejected; a repeated time needs an explicit earlier/later choice.
Shifts may cross midnight and last at most 48 elapsed hours. Date filters are UTC
dates and include shifts overlapping the period. Draft and published shifts for
the same typed employee cannot overlap; adjacent shifts are allowed. Cancellation
retains the record and audit history and releases the interval. A cancelled shift
cannot be reactivated. Scheduled duration does not alter recorded attendance,
approved time or pay.

Apply `20260914074151_production_work_shift_scheduling.sql` through the existing
migration process after prior migrations. It adds two RLS-protected tables,
private transactional functions and public invoker wrappers. Authenticated users
have SELECT only; write RPCs recheck current organization, actor permissions,
billing and active target membership. Organization locking serializes overlap
checks, optimistic versions prevent lost edits, and immediate same-request retries
return the committed result without another audit event. No hosted migration was
applied by this PR.

Run `bash scripts/test-shift-scheduling.sh` for disposable PostgreSQL RLS,
authority, lifecycle, overlap and two-connection concurrency checks. The web tests
cover API receipts, pagination, DST and stale-account handling. Before rollout,
apply the migration in staging, run hosted security/performance advisors, and use
real manager/employee accounts to create, publish, edit, cancel and revoke access.
Test a second browser editing the same version and a staff member who becomes
inactive. Verify cancelled/published visibility and hidden drafts independently.

Schedule-based attendance exceptions and review are now documented in
[shift-attendance-exceptions.md](shift-attendance-exceptions.md). Recurring shifts,
shift swaps and schedule notifications remain separate follow-up work. Audit snapshots are retained in
`work_shift_events`; this screen does not yet include an audit-history browser.
