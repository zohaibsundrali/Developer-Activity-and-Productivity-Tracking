# Typed timesheets and transactional review

Submitting a week now computes all its hours in PostgreSQL and serializes submission with log changes. Approval/rejection/reopening uses the same organization lock and validates the current state. Authenticated callers cannot directly insert, update or delete a timesheet to bypass that workflow. Admin and Developer submissions remain supported.

Time logs, reports and capacity calculations distinguish profile type as well as UUID. New decisions record the approver's type. Existing logs are backfilled only when membership and a corresponding organization profile identify a single type. Ambiguous or missing identities remain unresolved; they are not assigned to an arbitrary employee. Affected weeks cannot be submitted until their ownership is reviewed. An unresolved running timer also blocks a new timer for that identity.

New or changed task/project references must belong to the log organization and match one another. Existing unchanged historical references are preserved when stopping a timer. Explicit permission overrides are enforced in the database. Finance retains its existing timesheet-summary read access without default approval authority. Detailed time-log reads also remain subject to the existing monitoring scope from migration 046; a timesheet permission does not expand monitoring access. Own-week approval is prohibited using both identity fields. Submitted/approved hours remain locked until an authorized reviewer reopens the week. Terminal SDK session loss clears application identity caches; an unrelated tab's logout or transient verification error does not force logout of a valid local session.

## Rollout

1. Run the read-only `scripts/sql/timesheet-identity-preflight.sql`. If rows are returned, preserve them for identity review. Do not invent links or remove hours to make the check pass. Migration can retain those rows, but the affected weeks require repair before submission.
2. Apply the complete `supabase/migrations/20260912100844_production_transactional_timesheet_review.sql` once.
3. Apply the complete `supabase/migrations/20260912101315_production_typed_time_log_capacity.sql` once, after step 2.
4. Deploy the matching web changes. Coordinate SQL and web deployment: the new web code requires the new columns/RPCs, and the old submit endpoint cannot write timesheets after direct writes are revoked.
5. Check Admin and Developer timer/manual entry, submit, another approver's approve/reject/reopen, explicit permission denial, and Finance read access with real test accounts. Confirm reports and capacity separate typed profiles and show unresolved names honestly.

These files build on the existing migrated application, including migration 077 and current profile authority. Do not replay the full historical SQL bundle. No desktop rebuild is required for these changes. Production identity recovery, live provider integration, and operating-system capture are separate verification steps.

## Validation

4,097 web regression tests passed, and the production build passed. The isolated PostgreSQL suite covers the actual new migrations, typed identity collisions, permissions, billing locks, 1,002-log totals, task/project tenant checks, authorized deletion cleanup, and both submit/edit transaction orders. These fixtures do not replace live role-account testing against the deployed database.
