# Refresh imported GitHub tasks

Open an imported issue in the project GitHub panel and choose **Preview task refresh**. The screen compares the last recorded GitHub source, current local task, and freshly fetched issue for title and description. Remote-only changes default to applying GitHub content; local-only changes default to preserving the local value. Different edits on both sides require **Keep local version** or **Use GitHub version**. Plain text rendering keeps issue content inert.

Applying chosen changes advances the source baseline even when keeping local content. An unchanged remote edit therefore does not repeatedly cause a conflict. A later remote edit may require review again. Status, assignment, dates, visibility and approval stay under the existing task workflow. Re-importing an issue still returns the existing task without modifying it; refresh is a separate explicit action. There are no outbound GitHub writes or background jobs.

The endpoint uses the caller's organization-scoped client and existing task management/read permissions. It checks the project link before and after a bounded GitHub read. A provider fingerprint rejects changes after preview; a database snapshot fingerprint rejects stale local content, source revision or link version. The database serializes requests with the existing organization lock and locks the local task before comparing content. It reuses import validation, billing and active-project checks. Task updates run as the caller through existing RLS and task guards.

Each successful request stores an immutable audit event containing the previous snapshot, fetched source, choices, applied values and actor. A deferred constraint rejects an audit insert whose task changes were not applied. Failed task updates roll back the event. Identical request IDs and payloads return the existing event without overwriting subsequent local edits; changed payloads require a new ID. The browser retains the request ID after uncertain network failure and resets it when choices change. Audit history is stored in the database; this phase does not add a history browser. Use one refresh operation per transaction because deferred checks validate each event's applied state at commit.

GitHub credentials remain in browser memory, the app POST body and the provider authorization header. They never enter the SQL RPC or audit rows. Source metadata is a reference: an equally authorized direct database caller may supply a source snapshot through the guarded RPC, so it is not a cryptographic provenance guarantee. Existing source-length and issue-only restrictions apply. Deleted imports cannot be refreshed.

## Validation and rollout

Apply `20260914185642_production_github_issue_task_sync.sql` after the issue-import migration, then deploy the web update. This PR does not apply hosted migrations. Run staging security/performance advisors and verify actual manager/contributor permissions, explicit denials, private repository credentials, remote/local conflicts, uncertain retries and deleted tasks.

`bash scripts/test-github-issue-sync.sh` runs real task guards in disposable PostgreSQL, tests three-way choices, audited retries, restrictive update policies, unapplied audit rejection, workflow preservation and a two-connection stale-preview race. Vitest covers comparison rules, authenticated API boundaries, typed receipts, required choices, token placement, stable retry IDs and stale identity cleanup. Full suite/build results are recorded in the PR.

Background synchronization, GitHub App/OAuth, webhook delivery and two-way status policy remain later phases.
