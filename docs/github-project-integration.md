# GitHub project integration

Project detail pages now show a GitHub repository panel. Authorized project team
managers can link or disconnect one repository; project viewers can load issues
and pull requests and page through older activity. External titles are plain text
and links are generated for github.com. Closed pull requests are shown as closed,
not assumed merged. Activity reads remain read-only. Explicit issue-to-task import is available as a
separate confirmed action; status mapping, comments, webhooks and automatic
synchronization remain follow-up work.

Public repositories work without a token, subject to GitHub's unauthenticated
rate limits. For private repositories, each viewer supplies their own GitHub read
token in the panel. Give access only to the relevant repositories and read access
to Issues/Pull requests. The token stays in component memory, is sent in an HTTPS
POST body to this application's server and then only in the GitHub Authorization
header. It is not saved to database, local/session storage, URLs or logs by this
implementation. Refreshing the integration, changing account or unmounting clears
it. A repository link never grants another person access to private GitHub data;
their GitHub token must independently authorize that request. This is not a shared
GitHub App installation or OAuth connection.

The provider adapter pins API version 2026-03-10, fixes the API origin, refuses
redirects, limits response size/time and validates repository identity before
activity reads. Repository-ID pagination links and opaque `after` cursors are
validated and reconstructed on the fixed origin. Permissions and link version
are rechecked after the external request. Link mutations use optimistic versions,
organization locking and replay checks. Disconnect retains a version tombstone
so stale requests cannot silently restore an old link.

Apply `20260914083031_production_project_github_link.sql` after typed project
ownership, project staffing and current-profile authority migrations. Authenticated
clients have SELECT only; private functions derive identity/permissions, with
public invoker wrappers. No hosted migration was applied. Verify in staging with
an assigned contributor, unrelated contributor, scoped manager, owner, revoked
member and client. Run hosted security/performance advisors after applying DDL.

Validation: `bash scripts/test-project-github.sh` covers real project authority,
explicit denial, replay, disconnect and concurrent stale updates in disposable
PostgreSQL. Web tests cover provider validation, hostile pagination, secret
handling and account changes. A credential-free live check against
`octocat/Hello-World` loaded two pages of 30 records without repeated items.

References: [GitHub repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues),
[API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions),
[rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

Explicit issue-to-task import is now documented in [github-issue-task-import.md](github-issue-task-import.md). Automatic synchronization and GitHub writes remain separate.

Imported issue titles and descriptions can now be refreshed through a separate [explicit comparison and conflict resolution flow](github-issue-task-sync.md). Background synchronization remains pending.
