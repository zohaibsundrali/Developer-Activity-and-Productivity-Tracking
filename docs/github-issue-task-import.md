# GitHub issue to project task import

The project's GitHub activity panel now offers an explicit issue import for people with project read access, task management and permission to read the resulting unassigned task. Preview displays the current GitHub title/body as plain text and requires planned start/end dates. Import rereads the provider and rejects a changed preview fingerprint or repository link.

A new task is unassigned, internal (`client_visible=false`), feature type, medium priority and pending. GitHub's open/closed state is retained in the source snapshot; a closed GitHub issue never grants local completion or approval. The description contains the original issue body and a canonical source link. GitHub assignees, milestones, labels and deadlines are not mapped implicitly. Importing private issue content makes it available to authorized local task viewers; the preview explains this before creation.

The mapping uses stable repository and issue IDs plus issue number within the project. An organization lock and unique constraints prevent concurrent duplicates. The private helper reserves the mapping with a deferred task foreign key; the public invoker then inserts the task using the caller's existing RLS, quota, billing, review and relationship guards. Failure rolls back both rows. A reservation by itself cannot commit without its task. Repeated imports return the existing task and preserve local edits, status, assignment and planned dates. Deletion retains a mapping tombstone; import does not silently recreate deleted work. The same GitHub issue can be intentionally imported into different projects.

Only the server-fetched issue is passed from the application endpoint to the database. GitHub credentials remain in the view's memory, travel in the app request body and GitHub Authorization header, and never enter the import RPC or persisted source metadata. Database callers with equivalent full task-management authority can create import metadata through the guarded RPC; this is a source reference, not a cryptographic provenance attestation.

Limits: issue-only imports, title up to 255 characters, body up to 60,000 characters and a bounded encoded snapshot. Oversize content is rejected rather than silently truncated. Pull requests are rejected even when returned by the Issues endpoint. This phase creates one-way snapshots; automatic refresh, two-way task-status synchronization, GitHub App/OAuth installation and webhook delivery remain later work. No outbound GitHub write or new frontend task-created automation hook is added.

## Validation and rollout

Apply `20260914182129_production_github_issue_task_import.sql` after the task-authority and project GitHub-link migrations, then deploy the web update. No hosted migration is applied by this PR. After staging DDL, run security/performance advisors and verify real project-manager/contributor accounts, explicit denial, a private-repository token, preview conflicts, quota/billing rejection, local edits and deleted-task behavior.

`bash scripts/test-github-issue-import.sh` exercises real task guards plus a two-connection duplicate-import race in disposable PostgreSQL. Provider, API and view tests cover PR rejection, safe credential placement, link/access changes, changed previews, typed receipts, explicit dates and stale-account cleanup. A read-only public GitHub smoke test confirmed the live issue response without credentials; no live task was created.

GitHub contract: [Issues REST API](https://docs.github.com/en/rest/issues/issues#get-an-issue).
