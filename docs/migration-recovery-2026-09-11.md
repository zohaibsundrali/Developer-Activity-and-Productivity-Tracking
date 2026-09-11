# Recovery for the six reported SQL Editor failures

Use this recovery only when the five non-storage files below failed and rolled back, as reported. Do not replay it after success. The remaining migrations were reported successful; they do not need to be replayed.

1. Open `scripts/sql/production-migration-recovery.sql` and run the **entire file**, once, as `postgres` in Supabase SQL Editor. It contains the corrected migrations in this order:
   - `20260911095635_production_typed_notification_recipients.sql`
   - `20260911102420_production_notification_recipient_state.sql`
   - `20260911113526_production_typed_project_ownership.sql`
   - `20260911123702_production_typed_project_manager_roster.sql`
   - `20260911133042_production_transactional_task_assignment_notifications.sql`
2. Run `scripts/sql/storage-mapping-diagnostic.sql` and provide its result for the unresolved `documents` object. An uploader identity alone does not prove the owning organization. Do not assign a guessed organization, delete storage metadata, or bypass the accounting preflight.
3. Once all legacy objects have verified ownership and are mapped through supported paths/records, rerun `20260911062113_production_storage_accounting.sql`. The diagnostic covers the first reported object; further unmapped objects may exist.

The recovery creates the missing private schema with no public/application-role schema access. The project metadata backfills suspend only the named delivery billing trigger while holding a table lock inside the transaction, then restore its previous mode. Failure rolls back both DDL and data. Runtime billing enforcement and subscription states are unchanged. The manager-roster backfill also needed this fix even though its initial error was the missing manager column.

Missing `notification_recipients` and `manager_type` were downstream failures. The original SQL files are corrected for future deployments. This repair script is not a new versioned migration; it recovers the failed existing versions. SQL Editor execution does not automatically reconcile CLI migration history. Reconcile that separately against the actual schema before using `db push`.

Storage enforcement is still incomplete until the storage migration succeeds. Local PostgreSQL fixtures cannot verify hosted Storage API behavior or prove production migration success. After recovery, verify team-member notification privacy, read/unread state, assignment delivery, manager membership, and that locked subscriptions still reject application writes.

Validation: `bash scripts/test-audit-policies.sh` passed after these changes, including notification fixtures starting without `private`, ownership and manager backfills under a locked subscription, and a subsequent write that must still fail with `BILLING_LOCKED`. `git diff --check` passed. Hosted execution remains unverified.
