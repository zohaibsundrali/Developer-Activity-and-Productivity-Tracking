# Organization chooser and authenticated creation

## Audit and behavior

The public root was a server-rendered marketing page with no Auth redirect.
Login selected a typed profile from the identity's global `app_metadata` and
went directly to its dashboard. Registration collected account and organization
details, verified an email grant, then selected a plan and finalized an atomic
signup reservation. Logout already removed the SDK session, profile caches,
permissions and signed routing cookie; that cleanup remains in place.

Authorization previously assumed one active workspace per Auth identity:
`getAuthedOrg` read global user metadata, while database RLS compared token claims,
typed profile links and active memberships. `admin_users.email` was globally
unique. Simply adding cards or updating browser storage would not have produced
safe workspace switching.

The new behavior is:

- `/` keeps its public server-rendered content. A client-side, server-verified
  membership check redirects an authenticated owner/admin to `/organizations`.
  Anonymous users, logged-out users and ordinary staff keep the public Home.
- Owner/admin login opens the chooser. Other existing role login paths remain.
- `/organizations` lists only profiles linked by `auth_user_id` with active typed
  memberships in available organizations. Email matching is never authority.
  Project/member totals are returned only for owner/admin roles and respect
  explicit `project.view_all` / `member.view` permission denies.
- Both the card and its Open workspace button select the same authorized context.
  The account menu links back to Organizations.
- `/admin/registration` checks the SDK session before rendering. Anonymous users
  retain the existing email, verification-grant, plan and signup recovery flow.
  Signed-in users see organization details and plan selection, without account
  email/password fields or another OTP. The server still requires a verified
  account email and explicit terms acceptance.
- Creation atomically adds an organization-specific admin profile, owner
  membership, subscription and terms record linked to the existing Auth identity.
  Request IDs and a per-account transaction lock make retries idempotent.
  Existing active plan/trial rules apply; client payment/role/identity fields are
  ignored. Creation is limited to five new workspaces per account per hour.
- Successful creation opens the new workspace. If opening fails after creation,
  retry opens the already-created workspace instead of creating another.

## Session and authorization model

`app_private.workspace_sessions` records the selected typed profile per **Auth
session**, not globally on the Auth user. The custom access-token hook issues that
session's organization/profile/type/role claims. Other devices retain their
workspace. The global metadata remains the default for sessions without a choice.

The selection endpoint verifies the bearer token and binds the request to its
`sub` and `session_id`. The database independently validates the session owner,
current profile linkage, exact membership and organization state. The browser
refreshes its token, checks every workspace claim, loads the selected profile and
permissions, and obtains a signed routing cookie. A hard navigation discards
retained queries and components before entering the selected dashboard.

API authentication verifies the exact token before decoding context, then compares
it with the database selection. RLS uses the same selection. Old tokens stop
working after a switch. Suspension, role drift, profile relinking and deletion
freezes still fail closed. No browser role or `user_metadata` grants access.

Duplicated tabs can share an Auth session ID. A context observer checks this tab's
stored SDK session after refresh and returns to the chooser if its profile cache
no longer matches. It ignores unrelated tabs' broadcast payloads.

Existing background automation resolves its persisted actor through the linked
profile/membership, with an active job lease as its internal RLS context. A role
change in a secondary organization does not overwrite the primary organization's
Auth role. Deletion keeps its original ledger/recovery checks and retains Auth
identities still linked to another workspace. Deleted workspace selection receipts
remain until the Auth session is removed, so revocation never silently falls back.

## Deployment order — required before enabling the UI

This change has **not** been applied to the hosted database or pushed/deployed.
The web code requires the new database RPCs and Auth hook; do not deploy the app
alone.

1. Apply `20260920051306_authenticated_organization_workspaces.sql` through the
   established migration release process. It scopes admin profile email and Auth
   identity uniqueness to the organization; Auth login email remains unique.
2. In Supabase Authentication → Hooks, enable the Custom Access Token hook for
   `public.workspace_access_token_hook` (`pg-functions://postgres/public/workspace_access_token_hook`).
   If a custom token hook already exists, compose its behavior with this function
   rather than overwriting it. See the [Supabase hook documentation](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
3. Validate a test identity's sign-in and refresh, then deploy the application.
   No new public secrets, domain constants or callback URLs are needed.
4. Test an owner with two workspaces, ordinary staff, explicit logout, and a
   suspended membership against the deployed project. The separate desktop
   application's session must retain its original workspace.

Do not roll back only the Auth hook while selected sessions remain active: their
next refresh would revert to primary metadata. A rollback needs coordinated
session revocation/re-login and the previous application/schema behavior. Do not
restore global profile email uniqueness while multi-organization profiles exist.

## Verification

- Vitest covers identity-only route authentication, input/terms validation,
  creation idempotency parameters, forged identity/session inputs, inaccessible
  selections, verified token/context matching, stale tokens, SDK broadcast
  isolation and secondary membership role updates.
- `database/tests/authenticated_organization_workspaces.sql` runs the existing
  transactional signup tests plus multi-workspace SQL assertions: account reuse,
  repeated requests, mandatory-write rollback, RLS isolation, separate sessions,
  revoked/relinked/suspended/deletion-blocked memberships and restricted grants.
- `database/tests/workspace_lifecycle_integration.sql` runs the real automation,
  retention and deletion fixtures before testing secondary workspace automation
  and deletion without losing the primary workspace or shared Auth identity.
- Production build and browser checks cover owner-root routing, staff/anonymous
  public Home, credential-free authenticated setup, successful workspace handoff,
  keyboard plan selection, explicit logout, empty organizations and responsive
  layouts at 1440, 768 and 390 pixels. Browser accounts/API responses are mocked;
  these checks do not claim a live hosted Auth-hook deployment test.
- Supabase security advisors were run on the disposable local SQL fixture. There
  were no findings for the new workspace objects. Four search-path warnings
  belonged to fixture-only helper functions.

Run `npm test -- --maxWorkers=4` and `npm run build`. Expand either SQL fixture
with `python3 scripts/expand-sql-fixture.py database/tests/<fixture>.sql` and feed
it to `psql -v ON_ERROR_STOP=1` in an **empty disposable PostgreSQL database**.
Never run test fixtures against the hosted project. The existing Playwright
login helper now chooses the seeded primary workspace after owner/admin login.

For mocked browser QA against a running production build:

```sh
E2E_BASE_URL=http://127.0.0.1:3000 node scripts/test-organization-browser.cjs
```

This script intercepts Supabase and application API calls, so it does not create
live accounts or organizations. Screenshots go to the ignored
`test-results/organization-workspaces/` directory. Set
`PLAYWRIGHT_EXECUTABLE_PATH` only if Chromium is installed at a custom location.
