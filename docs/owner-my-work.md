# Owner task assignment and My Work

Tasks retain `developer_tasks.developer_id → developers.id`. The new
`assignee_admin_id → admin_users.id` represents Owner/admin profiles. A check
constraint allows one populated assignee column, or neither for unassigned work.
Active organization membership is checked on every assignment. Profile type and
profile ID together identify an assignee; auth account IDs are not profile IDs.

`taskAssignment.js` resolves this identity consistently for the UI, permissions,
automations, and notification access. `assignTask` changes both columns in one
write and accepts legacy developer IDs as well as typed member objects. Existing
management permissions still govern assignment, including completed tasks.

My Work selects only the current profile's assignee column within the current
organization. Task creation, project ownership, review authority, and management
visibility do not add rows to this personal list. Tasks load using stable ID
keyset pages without a total cap; project lookups are organization-scoped and
batched. Existing grouping and outstanding-count rules are unchanged.

Owners can open a task from My Work and submit proof through the existing
completion modal and service transaction. Admin-profile self-submission uses
existing `task.manage` authority, or an explicit `task.submit` grant. Developer
profiles retain their existing `task.submit` requirements, including overrides.
Management submission on another person's behalf remains supported. Storage
checks resolve the task, project, organization, and current assignee.

Submissions, review history, and activity retain the typed author. Review still
requires existing project review authority and `task.review`. Both the current
assignee and submission author are checked to prevent self-review. Owner work
keeps task scoring and project totals; employee productivity metrics continue to
refer only to Developer profiles.

Assignment notifications use the actual database OLD/NEW identities. Existing
self-notification suppression remains. Previous assignees receive only their old
title snapshot, without live task/project links. Reassignment or unassignment
supersedes pending proof and returns review-stage tasks to pending; historical
proof cannot be approved for a new assignee. Recurring tasks and automation
assignment preserve typed assignment semantics.

Apply both migrations in order:

- `20260922053957_typed_owner_task_assignment.sql`
- `20260922061722_preserve_completed_task_assignment.sql`

Both are deployed to the configured app project. No existing developer FK or
role permission was removed. The second migration preserves completed-task
reassignment while keeping the reviewed author in the historical records.

## Verification

- Full Vitest suite and production build.
- `database/tests/typed_owner_task_assignment.sql`: real task RLS, cross-profile
  UUID collision, explicit permission overrides, assignment notifications,
  submission/review transactions, self-review denial, and completed-task
  reassignment. The adjacent fixture is for an **empty local test database**
  with the full application schema and both migrations; its test-only workspace
  resolver must never be applied to production.
- `scripts/qa/owner-my-work.cjs`: live QA sessions for all 11 staff roles, Owner
  self-assignment, delegation, Developer/Employee proof, reassignment,
  unassignment, reload persistence, organization isolation, permission denials,
  notifications, and independent review. Run with `E2E_ALLOW_WRITES=1` and
  `E2E_BASE_URL` pointing at the tested app build.
- `scripts/qa/owner-my-work-browser.cjs`: browser dropdowns, personal visibility,
  reload/refresh, and timer start/stop failures followed by successful retries.
- Existing `scripts/qa/task-lifecycle.cjs`: Developer plan submission, plan review,
  proof rejection/resubmission, approval, and scoring regression.

Live scripts accept only the existing synthetic QA accounts, create temporary
projects/files, and remove their run-scoped data afterward. Results and browser
screenshots are written under ignored `test-results/`.
