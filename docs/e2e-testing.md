# End-to-end testing

Browser-level tests that drive the real application in a real Chromium, through
the real login form, against a real Supabase project. They exist to answer one
question the unit tests cannot: **does a person in each role actually get
their job done, and does nobody get anyone else's data?**

- Runner: [Playwright](https://playwright.dev) — `npm run test:e2e`
- Specs: `e2e/*.spec.js`, one per role plus `isolation.spec.js`
- Fixtures: `e2e/fixtures/` — credential loading, login helper, skip contract
- Config: `playwright.config.js`

The unit suite is untouched and stays where it is: `npm test` runs Vitest over
`tests/**/*.test.js`. The two runners cannot see each other's files — Vitest
collects only `*.test.js` under `tests/`, Playwright only `*.spec.js` under
`e2e/`.

---

## 1. The skip contract

**No credentials, no failures.** Every spec asks for what it needs up front and
calls `test.skip()` with the exact variable names when something is missing:

```
-  1 [chromium] › owner.spec.js:23:7 › Owner › signs in and lands on the admin console
     skip: No owner credentials — set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD (see docs/e2e-testing.md).
```

A clean checkout with no secrets therefore reports `55 skipped`, not 55 confusing
red failures. Configure only the roles you care about and the rest keep skipping.

The same applies inside a spec: no seeded project for the developer, no employees
in the directory, no reviewed task with feedback — each skips with a sentence
saying what to seed.

---

## 2. Environment variables

### 2.1 Credentials — one pair per role

| Variable | Used by | Required for |
| --- | --- | --- |
| `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD` | `owner.spec.js`, `isolation.spec.js` | Org A owner |
| `E2E_MANAGER_EMAIL`, `E2E_MANAGER_PASSWORD` | `manager.spec.js` | Org A manager |
| `E2E_HR_EMAIL`, `E2E_HR_PASSWORD` | `hr.spec.js` | Org A HR |
| `E2E_DEVELOPER_EMAIL`, `E2E_DEVELOPER_PASSWORD` | `developer.spec.js`, `isolation.spec.js` | Org A developer |
| `E2E_EMPLOYEE_EMAIL`, `E2E_EMPLOYEE_PASSWORD` | `employee.spec.js` | Org A employee |
| `E2E_CLIENT_EMAIL`, `E2E_CLIENT_PASSWORD` | `client.spec.js`, `isolation.spec.js` | Org A client |
| `E2E_ORG_B_OWNER_EMAIL`, `E2E_ORG_B_OWNER_PASSWORD` | `isolation.spec.js` | Org B owner |
| `E2E_TEAM_LEAD_EMAIL`, `E2E_TEAM_LEAD_PASSWORD` | `roles-extra.spec.js`, `api-probe.spec.js` | Org A team lead |
| `E2E_FINANCE_EMAIL`, `E2E_FINANCE_PASSWORD` | `roles-extra.spec.js`, `api-probe.spec.js` | Org A finance |
| `E2E_QA_EMAIL`, `E2E_QA_PASSWORD` | `roles-extra.spec.js`, `api-probe.spec.js` | Org A QA |
| `E2E_DESIGNER_EMAIL`, `E2E_DESIGNER_PASSWORD` | `roles-extra.spec.js`, `api-probe.spec.js` | Org A designer |
| `E2E_DEVOPS_EMAIL`, `E2E_DEVOPS_PASSWORD` | `roles-extra.spec.js`, `api-probe.spec.js` | Org A devops |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | `admin-modules.spec.js`, `roles-extra.spec.js`, `api-probe.spec.js` | Org A admin (invited, in `admin_users`) |
| `E2E_ORG_B_DEVELOPER_EMAIL`, `E2E_ORG_B_DEVELOPER_PASSWORD` | written by `seed.spec.js` | Org B developer |

Every role is optional: a missing pair skips that role's tests with a message.

### 2.2 Automatic role detection and expected destination

The login form asks for email and password only. Supabase verifies the account;
the app resolves its profile and membership role automatically.

| Role | Default expectation | Lands on |
| --- | --- | --- |
| organization owner, admin, org B owner | `admin` | `/organizations`, then the selected `/admin/dashboard` |
| manager, HR, team lead, finance, QA | `team-admin` | `/admin/dashboard` |
| developer, employee, designer, devops | `team` | `/developer/dashboard` |
| client | `client` | `/client` |

`E2E_<ROLE>_PORTAL` overrides the test's expected destination; it never selects
a role or grants access. Valid values are `admin`, `team`, `team-admin`, `client`.
`credentialsFor()` exposes `area` (`admin`, `staff`, `client`) for spec assertions.
Manager and HR defaults match accounts created through Add Employee. A legacy
profile in `admin_users` may use `admin`; its destination is the same console.

`E2E_<ROLE>_ORGANIZATION_ID` pins a role to an exact organization in the chooser.
For disposable runs, `E2E_QA_ORG_A_ID` applies to all Org A roles and
`E2E_QA_ORG_B_ID` to `orgBOwner`. A configured organization must be accessible;
the helper never substitutes another workspace when it is missing.

Use a dedicated **organization owner**, not the platform-owner account, for
`E2E_OWNER_*`. Platform owners are routed to `/admin` and need separate platform
console tests. These role specs test organization dashboards.

### 2.3 Fixtures the isolation spec needs

| Variable | What it must be |
| --- | --- |
| `E2E_ORG_B_PROJECT_ID` | id of a project owned by **organisation B** |
| `E2E_ORG_B_PROJECT_NAME` | that project's exact name — the string that must never appear for an org A user |
| `E2E_INTERNAL_PROJECT_ID` | id of an **organisation A** project the client is *not* linked to |
| `E2E_INTERNAL_PROJECT_NAME` | that project's exact name |
| `E2E_INTERNAL_TASK_ID` | id of a task on an org A project with `client_visible = false` |
| `E2E_CLIENT_PROJECT_ID`, `E2E_CLIENT_PROJECT_NAME` | an org A project the client **is** linked to — what `client.spec.js` opens (tabs, conversation) |

Give the two projects distinctive names (`"ORG-B-SECRET-ROADMAP"`,
`"ORG-A-INTERNAL-ONLY"`). The isolation assertions search the rendered page and
the API response body for these strings, so a name like "Website" would collide
with unrelated content and produce a false failure.

### 2.4 Run options

| Variable | Default | Effect |
| --- | --- | --- |
| `E2E_ENV_FILE` | unset | Load only this environment file instead of `.env.e2e`; relative paths resolve from the repository root. A missing explicit file fails immediately. Existing environment variables retain precedence. |
| `E2E_BASE_URL` | `http://localhost:3000` | Target URL. **When set, Playwright does not start its own server** — it assumes something is already running there (a preview deploy, a local `npm start`). |
| `E2E_ALLOW_WRITES` | unset (off) | Opts in to the tests that write: submitting a task plan, completing a task, sending a support request, creating a department/team/test case/run, recording a test result. Off by default so a normal run cannot mutate the seeded tenants. Every write is idempotent — a rerun finds what the first run created. |
| `E2E_SEED` | unset (off) | Enables `seed.spec.js`, which creates the accounts and fixtures above through the product's own screens and appends the resulting `E2E_*` lines to `.env.e2e`. See §3.4. |
| `CI` | unset | Enables retries (2), single worker, `--forbid-only` and the GitHub reporter. |

### 2.5 Server-side variables (not test config, but the run fails without them)

The app under test needs these in its own environment, or **every login will
fail** at the "Could not establish a secure session" step:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-side data access for the client API routes
- `SESSION_COOKIE_SECRET` — signs the HttpOnly session cookie the middleware
  verifies (falls back to `SUPABASE_SERVICE_ROLE_KEY` if unset)

### 2.6 Local convenience file

`playwright.config.js` seeds `process.env` from `.env.e2e` at the repo root if it
exists. Set `E2E_ENV_FILE=/tmp/verisade-qa-run.env` to load an isolated run file instead; the default file is then ignored. Do not commit credential files. `.env*` is already git-ignored, so that file cannot be committed by
accident. Values already in the environment always win, so CI secrets are never
overwritten.

```ini
# .env.e2e — local only, never committed
E2E_OWNER_EMAIL=owner@acme-test.example
E2E_OWNER_PASSWORD=…
E2E_CLIENT_EMAIL=client@acme-test.example
E2E_CLIENT_PASSWORD=…
E2E_ORG_B_PROJECT_ID=…
E2E_ORG_B_PROJECT_NAME=ORG-B-SECRET-ROADMAP
```

**Never put a real customer's credentials in here.** Seed dedicated test
accounts in a dedicated Supabase project or branch.

---

## 3. Seeding two organisations and six users

The suite needs two tenants so cross-organisation isolation can be proved rather
than assumed.

```
Organisation A (the tenant under test)      Organisation B (the neighbour)
├── owner        → admin_users              ├── owner  → admin_users
├── hr           → admin_users              └── project "ORG-B-SECRET-ROADMAP"
├── manager      → developers
├── developer    → developers
├── employee     → developers
├── client       → clients
├── project assigned to the developer
├── project "ORG-A-INTERNAL-ONLY" (client NOT linked)
└── task on it with client_visible = false
```

### 3.1 Each user needs linked Auth, profile and membership records

Create disposable accounts through the application's registration, employee
provisioning and invitation flows so all identity links are established together.
A manually inserted profile or matching email alone cannot sign in.

The resulting account requires:

1. A confirmed Supabase Auth user that can pass `signInWithPassword`.
2. Trusted `app_metadata` with `user_type`, `app_user_id`, `organization_id`
   and the current membership role. User-editable `user_metadata` grants no access.
3. The exact profile in `admin_users`, `developers` or `clients`, with matching
   `id`, `organization_id` and `auth_user_id` pointing to that Auth user.
4. An active `memberships` row for the typed profile and organization.

`memberships.user_id` identifies the profile, not the Auth uid; `user_type` is
`admin`, `developer` or `client`. A suspended membership must be refused. There
is no plaintext-password login fallback. Existing users with broken identity
links need the documented administrator recovery process; do not patch them
by matching email during login.

### 3.2 Data the specs look for

- **A project assigned to the developer** (`projects.assigned_developer_id`) —
  otherwise the task, submission and timer tests skip.
- **At least one employee** in org A with an `employee_profiles` row — otherwise
  the HR directory and offboarding tests skip.
- **A project linked to the client** — otherwise the client project, tabs and
  conversation tests skip.
- **`ORG-A-INTERNAL-ONLY`**: an org A project with **no** client link, carrying a
  task with `client_visible = false`. Export its id and name, and the task's id.
- **`ORG-B-SECRET-ROADMAP`**: any project in org B. Export its id and name.

### 3.3 Sanity check before your first run

The isolation spec has a **control test** that signs in as org B's owner and
opens `ORG-B-SECRET-ROADMAP` — if that test fails, the id is wrong or stale and
every "org A cannot see it" result below it would have been meaningless. Fix the
control first.

### 3.4 Or let the product seed itself — `seed.spec.js`

Everything in §3.1–3.2 except the two organisations can be created by the app,
through the same forms a person would use. With two freshly signed-up owners in
`.env.e2e` (`E2E_OWNER_*`, `E2E_ORG_B_OWNER_*`):

```bash
E2E_SEED=1 npx playwright test e2e/seed.spec.js
```

walks Add employee (one person per staff role), Create client account, Send
invitation → `/invite/<token>` → Accept (the admin), Add New Project (the
internal project, assigned to the developer), a second project linked to the
client through Clients → Project links, the developer's task plan (the
internal task, `client_visible = false`), and organisation B's developer and
project — and appends every resulting `E2E_*` line to `.env.e2e`. Each step
skips when its variable is already there, so a partial failure is resumed by
running it again. Emails are `verisade-qa-<role>-<a|b>@example.com`; passwords
are generated and never printed.

Because it goes through the real screens, it is also the first place a broken
onboarding form shows up: it is how the admin-invitation acceptance bug
(`admin_users.company` NOT NULL) was found.

---

## 4. Running

### Locally, letting Playwright build and boot the app

```bash
npm install
npx playwright install --with-deps chromium   # once
npm run test:e2e
```

`playwright.config.js` runs `npm run build && npm start` and waits for
`http://localhost:3000`. The first build takes minutes; the webServer timeout is
set to 10 minutes for that reason. An already-running server on that port is
reused locally (`reuseExistingServer`), never in CI.

### Against something already running

```bash
npm run build && npm start &                       # or a preview deployment
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

Setting `E2E_BASE_URL` disables the managed webServer entirely.

**Not against the Vercel deployment.** Its Security Checkpoint challenges a
headless browser after a few logins ("Failed to verify your browser, Code 10")
and every spec then fails at the login form. Run the production build locally
(`npm run build && npx next start -p 3100`, then `E2E_BASE_URL=http://localhost:3100`)
against the same Supabase project instead.

### Useful invocations

```bash
npm run test:e2e:list                    # collect and syntax-check, run nothing
npm run test:e2e -- isolation.spec.js    # one spec
npm run test:e2e -- -g "cannot"          # only the negative tests
npm run test:e2e -- --headed --debug     # watch it happen
npm run test:e2e:ui                      # Playwright UI mode
npx playwright show-report               # last HTML report
E2E_ALLOW_WRITES=1 npm run test:e2e      # include the mutating flows
```

### CI (GitHub Actions)

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: npm }
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
      env:
        CI: true
        # App runtime
        NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
        SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.E2E_SUPABASE_SERVICE_ROLE_KEY }}
        SESSION_COOKIE_SECRET: ${{ secrets.E2E_SESSION_COOKIE_SECRET }}
        # Test accounts
        E2E_OWNER_EMAIL: ${{ secrets.E2E_OWNER_EMAIL }}
        E2E_OWNER_PASSWORD: ${{ secrets.E2E_OWNER_PASSWORD }}
        E2E_MANAGER_EMAIL: ${{ secrets.E2E_MANAGER_EMAIL }}
        E2E_MANAGER_PASSWORD: ${{ secrets.E2E_MANAGER_PASSWORD }}
        E2E_HR_EMAIL: ${{ secrets.E2E_HR_EMAIL }}
        E2E_HR_PASSWORD: ${{ secrets.E2E_HR_PASSWORD }}
        E2E_DEVELOPER_EMAIL: ${{ secrets.E2E_DEVELOPER_EMAIL }}
        E2E_DEVELOPER_PASSWORD: ${{ secrets.E2E_DEVELOPER_PASSWORD }}
        E2E_EMPLOYEE_EMAIL: ${{ secrets.E2E_EMPLOYEE_EMAIL }}
        E2E_EMPLOYEE_PASSWORD: ${{ secrets.E2E_EMPLOYEE_PASSWORD }}
        E2E_CLIENT_EMAIL: ${{ secrets.E2E_CLIENT_EMAIL }}
        E2E_CLIENT_PASSWORD: ${{ secrets.E2E_CLIENT_PASSWORD }}
        E2E_ORG_B_OWNER_EMAIL: ${{ secrets.E2E_ORG_B_OWNER_EMAIL }}
        E2E_ORG_B_OWNER_PASSWORD: ${{ secrets.E2E_ORG_B_OWNER_PASSWORD }}
        E2E_ORG_B_PROJECT_ID: ${{ secrets.E2E_ORG_B_PROJECT_ID }}
        E2E_ORG_B_PROJECT_NAME: ${{ secrets.E2E_ORG_B_PROJECT_NAME }}
        E2E_INTERNAL_PROJECT_ID: ${{ secrets.E2E_INTERNAL_PROJECT_ID }}
        E2E_INTERNAL_PROJECT_NAME: ${{ secrets.E2E_INTERNAL_PROJECT_NAME }}
        E2E_INTERNAL_TASK_ID: ${{ secrets.E2E_INTERNAL_TASK_ID }}
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: playwright-report
        path: playwright-report/
```

Point CI at a **dedicated Supabase project or branch**, never production.

---

## 5. What each spec asserts

### `owner.spec.js` — the account that owns the tenant
- Signs in through automatic role detection and organization selection, lands on `/admin/dashboard`, and the sidebar
  carries every owner section (All Projects, Task Reviews, Reports, Add/View
  Developers, Employees, Team Stats, Organization, Clients, Billing, System Health).
- **Organisation**: the five tabs render; Departments and Teams offer their
  create forms.
- **Members and roles**: the roster columns render, the signed-in owner appears
  in their own organisation's member list, and the owner's role control is
  *disabled* — ownership cannot be handed away from that dropdown.
- **Invitations**: the invite form exists with email + role + team scoping. The
  form is filled but never submitted, so no invitation is sent.
- **Projects**: the org project list renders and the Add New Project dialog
  opens (when the org has a developer to assign to).
- **Reports**: all five analytics tabs render their panel — Activity trend, Top
  projects by workload, Completed tasks per person, Time tracking, Deadline delays.
- Task Reviews, Clients, Billing and System Health are reachable.
- **Logout** returns to `/login` and re-entering `/admin/dashboard` bounces.

### `manager.spec.js` — supervisory staff
- Defaults to the manager-scoped admin console, matching `dashboardHomeFor()`.
- Checks Employees, projects and task review access while restricted Billing,
  Clients and Automation sections remain absent.
- Includes legacy staff-area assertions when an explicit portal override is used.

### `hr.spec.js` — people operations
- Sees Employees, Team Stats, Organization — and **not** Add Developer or View
  Developers (both screens were folded into Employees), Billing, Clients, All
  Projects, Task Reviews, Automation, System Health.
- **Employees**: the directory renders with its search box, role and department
  filters, the headcount tiles and the per-role tiles under "By role".
- **Onboarding**: the Add Employee dialog, opened from Employees, collects name,
  email, role and password, and offers only roles ranking below the caller's
  own; the organisation invite form offers a role.
- **Offboarding**: every employee card exposes an enabled Deactivate/Activate
  control — the toggle that writes `memberships.status`, which is what actually
  revokes access at next login.
- **Profiles**: an employee profile opens with its HR fields (designation,
  skills) and closes again.
- A hand-edited `?section=billing` falls back to the overview instead of opening
  billing — `canAccessAdminSection()` holding under a typed URL.

### `developer.spec.js` — individual contributor
- Lands on the staff dashboard with Dashboard / My Projects / Account and **no**
  Team section.
- **Assigned work**: the dashboard summarises their projects; the project list
  either lists projects or shows its empty state (a silent blank panel fails).
- **Tasks**: the project task plan renders with its schedule.
- **Submission**: the plan is either submittable (Save/Resubmit Task Plan, and
  never stuck on "Login Required") or already in review/approved. With
  `E2E_ALLOW_WRITES=1` it actually submits and waits for confirmation.
- **Timer**: the per-task lifecycle control is present in one of its states —
  Start Task / Mark as Completed / Locked / "save task plan first". With writes
  enabled, completing opens the review modal with its notes field.
- **Comments**: admin review feedback renders on a reviewed task (skips when the
  seed has none). Authoring threaded comments is an owner/admin/manager surface.
- **Time tracking**: `/sessions` shows their own session history, scoped to their
  identity rather than a queryable id.

### `employee.spec.js` — the narrowest internal role
- Dashboard / My Projects / Account only; **no** Team.
- **Own profile**: the account section shows the signed-in identity.
- **Assigned work**: only their own projects.
- **Time tracking**: their own session history.
- A hand-edited `?section=team` does **not** render the roster or the direct
  reports panel.
- `/admin/dashboard` bounces to `/login`.

### `client.spec.js` — external customer
- Lands in the portal with Overview / My Projects / Announcements / Approvals /
  Invoices / Support / Account — and **no** internal sections.
- **Projects**: linked projects list, and a project opens with its client-facing
  tabs (Milestones, Tasks, Deliverables, Conversation).
- **Invoices**: billing history renders (table or empty state).
- **Messaging**: a support request can be composed (sent only with
  `E2E_ALLOW_WRITES=1`), and the per-project conversation box is available.
- **Account** shows the signed-in client.
- `/admin/dashboard` and `/developer/dashboard` both bounce to `/login`.

### `admin-modules.spec.js` — every console section, and what each is for
- **Owner and admin** each click *every* sidebar entry they are offered (the
  list is read off the sidebar, not typed into the spec). Each must render the
  `<h1>` that `sectionTitles.js` gives the section and no error state —
  `ErrorState`'s `role="alert"` with "Try again", the permission layer's
  "temporarily unavailable", or Next's error boundary. The walked list is
  attached to the report. Permissions is present for the owner and absent for
  the admin.
- **Billing** shows the current plan — the screen that displayed the
  permission-layer outage as "Couldn't load billing".
- **Organization**: a department and a team are created (idempotent), Members
  lists the owner, Settings renders.
- **Employees** lists the seeded people; **Team Structure** renders the
  reporting-lines editor; **All Projects** opens the internal project's detail
  page; **Quality** writes a test case and starts a run against it, then opens
  the run; Leave/Timesheet approvals and Permissions render.

### `roles-extra.spec.js` — team_lead, finance, qa, designer, devops, admin
- Each lands in the right **area** (console or staff dashboard), walks every
  sidebar entry it is offered the same way, and is checked against a handful
  of entries the permission catalogue says it must and must not have — finance
  gets Billing/Invoicing/Contracts/Assets and not All Projects or Employees; qa
  gets Task Reviews/Quality/Bugs and not Billing; designer and devops get the
  staff shell with Tests and no Team, and `/admin/dashboard` bounces them.
- **The staff Tests screen**: a developer opens the run the admin-modules spec
  started and records a result (with `E2E_ALLOW_WRITES=1`).

### `api-probe.spec.js` — every role, every readable route, never a 5xx
- Signs in as each of the twelve roles and calls every parameterless GET route
  (plus the project-scoped ones when the seed provides an id) with that role's
  own token. 200/400/403/404 are all acceptable answers; any 5xx fails, and the
  full status sheet is attached to the report.
- `/api/me/permissions` must answer 200 for every role, and
  `/api/billing/subscription` for the billing roles. This is the regression
  test for the PostgREST-ambiguity outage (migration 069 → the fix in
  `permissionOverrides.js`) during which every permission-gated route answered
  503 for every role.

### `isolation.spec.js` — the one that matters most

Cross-organisation:
1. **Control**: org B's own owner CAN open `ORG-B-SECRET-ROADMAP` by URL. Without
   this, every negative below could pass on a stale id and prove nothing.
2. Org A's **owner** opening `/admin/project-details/<org-B-id>` gets the error
   state, and org B's project name appears nowhere in the rendered page.
3. Same for `/admin/gantt-chart/<org-B-id>`.
4. Org A's **developer** opening `/developer/project-details?id=<org-B-id>` sees
   nothing of it either.
5. **Search** (`/api/search`) as org A never returns org B's project — probed at
   the API with the caller's own bearer token, because RLS is the real boundary.

Client versus internal:
6. A signed-in client is bounced from `/admin/dashboard`, `/developer/dashboard`
   and `/admin/dashboard?section=employees`.
7. The **employee directory** never renders for a client — neither its heading
   nor its search control.
8. `/api/client/tasks/<internal-task-id>` answers 401/403/404, never 200.
9. `/api/client/projects/<unlinked-project-id>` is refused *and* the refusal body
   does not leak the project name.
10. `/client?section=projects&projectId=<internal-id>` renders nothing of that
    project.
11. Client **search** returns no `employee`, `team` or `client` results — the
    `CLIENT_TYPES` allow-list in the search route is load-bearing for the tables
    whose RLS policies are still org-wide rather than client-aware.
12. Internal staff cannot enter `/client`.

---

## 6. Conventions

**Selectors are roles and accessible names, never CSS classes.** `getByRole('button',
{ name: 'Employees' })`, `getByRole('heading', { level: 1, name: 'Organization' })`.
A class-based selector breaks on any restyle and tells you nothing about whether
the app is usable; a role-based one fails only when the app is genuinely broken —
and doubles as an accessibility check.

Login inputs use `getByLabel` with their associated accessible labels. One
`.auth-error-box` lookup in `e2e/fixtures/auth.js` quotes the app's error text
into a failure message; it is diagnostic only and never asserted on.

**Reads by default.** The suite runs against shared seeded tenants, so tests that
would create or mutate rows are gated behind `E2E_ALLOW_WRITES=1`. Everything
else asserts that controls exist, are enabled, and open — without leaving data
behind.

**Assertions never silently pass on an empty page.** Where content depends on the
seed, the test asserts "the list *or* its empty state" so a failed fetch that
renders nothing is still a failure.

## 7. Housekeeping

Playwright writes `playwright-report/` and `test-results/`; both are
git-ignored, as is `.env.e2e` (via `.env*`).
