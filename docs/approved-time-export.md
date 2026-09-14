# Approved-time payroll preparation

The admin **Payroll Preparation** entry is available to organization timesheet
viewers, including finance. It exports a CSV for up to 13 complete weeks selected
by Monday dates. The database reads approved rows in one statement snapshot, so
export does not combine inconsistent API pages when someone reopens a week. A
result over 10,000 staff-week rows fails explicitly; choose a narrower period.

Each row contains typed staff identity, name when a profile still exists, exact
approved seconds, rounded hours, timesheet ID, approval actor/time and source
updated timestamp. Missing historical profiles retain their typed ID and the
label “Staff member”; missing approval/ownership evidence blocks the export.
Client billing rates and billable time do not determine payroll wages.

The SHA-256 fingerprint covers the organization, selected range and returned
source records. Download time is excluded, so retrying unchanged data yields the
same fingerprint. This recognizes repeated exports; it is not a paid ledger and
does not automatically prevent duplicate imports into another payroll system.
Corrections retain timesheet IDs and change source timestamps/fingerprints.
Reconcile corrected rows against previous imports rather than adding them again.
CSV formula prefixes are escaped. Responses are private/no-store and use the
caller's verified permissions. Account changes invalidate pending downloads.

No wages, overtime, deductions, taxes, exchange rates or payouts are calculated.
This is a payroll input export. Set those rules in the selected payroll system.

Apply `20260914082024_production_approved_time_export.sql` after the timesheet
review and current-profile authority migrations. It adds an approved-row index,
a private read-only function and public invoker wrapper. No hosted database was
changed by this PR. Run `bash scripts/test-approved-time-export.sh` for real SQL
permission checks, actual approval/reopen transitions and >1,000-row coverage.
Then apply in staging, run security/performance advisors and verify real owner,
finance and employee accounts before rollout.
