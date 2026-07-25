# SaaS Multi-Tenant + Roles — QA Checklist

Run this **after** applying migrations `010`→`014` and confirming `VERIFY_saas.sql`
shows all ✅. Goal: prove complete **data isolation** between organizations and
correct **role access**, with **no regression** in the existing tracking app.

Legend: ☐ = to test.

---

## 0. Setup (two organizations)
- ☐ Sign up **Org A** owner via `/admin/registration` → "Create organization".
- ☐ Sign up **Org B** owner (different email) the same way.
- ☐ As Org A owner, invite one of each role (Members/Invitations tab):
  **admin, manager, employee, developer, client** (client invite should pick a project).
- ☐ Accept each invite two ways: via the emailed `/invite/<token>` link **and** via
  `/admin/registration` → "Join with code" (paste the token). Both must create the account.

## 1. Organization isolation (the critical one)
- ☐ Org A admin logs in → sees only Org A projects/developers/tasks/tracking.
- ☐ Org B admin logs in → sees only Org B data. **No overlap** with Org A.
- ☐ In DB (SQL editor as service role is not a fair test — use the app/JWT):
  confirm every `projects`, `developer_tasks`, `task_submissions`, `memberships`
  row a user sees has their own `organization_id`.
- ☐ Try to open an Org B project id while logged in as Org A → blocked / not found.

## 2. Role access — staff
- ☐ **Developer** login (Team Member button) → `/developer/dashboard`: Overview,
  My Projects, Account. **No** Team section.
- ☐ **Employee** login → same as developer, sidebar shows "Employee · <Org>".
- ☐ **Manager** login → sidebar shows "Manager · <Org>", **Team** nav present.
  Team panel lists org roster + projects (read-only), scoped to the manager's org only.
- ☐ As developer/employee, manually visit `/developer/dashboard?section=team`
  → must **fall back to Overview** (no team data leaked).

## 3. Role access — admin/owner
- ☐ **Owner** login → Organization → Settings is **editable**, Save works.
- ☐ **Admin** (invited) login → Organization → Settings shows the **view-only lock
  banner**, all fields disabled, no Save button. Members/Invitations/Teams still work.
- ☐ Owner-only: admin cannot change org profile/working-hours/security.

## 4. Client portal isolation
- ☐ **Client** login → `/client` only. Sees only their **linked** project(s).
- ☐ Client cannot see: productivity, keyboard/mouse stats, screenshots, app usage,
  staff lists, other clients' projects, or draft invoices.
  - ☐ Hit `/api/client/projects/<other-org-or-unlinked-id>` → **403/empty**.
  - ☐ Confirm no tracking tables are readable by the client JWT (RLS `track_read`
    excludes clients).
- ☐ Client can: view announcements, approvals (approve/reject), non-draft invoices
  (+ PDF), support threads (send/receive).

## 5. Invitations & roles integrity
- ☐ Invited **owner** lands in `admin_users` (admin dashboard), membership role `owner`.
- ☐ Invited **manager/employee** land in `developers` (staff), membership role preserved.
- ☐ Invited **client** lands in `clients` (never `developers`), project linked.
- ☐ Re-using an accepted/expired/revoked token → clear error (no duplicate account).

## 6. No regression (existing desktop tracking)
- ☐ Desktop tracker still logs in and inserts rows into `productivity_sessions`,
  `keyboard_stats`, `mouse_activities`, `app_usage`, `screenshots`, `browser_usage`
  (RLS `track_insert` is open for insert; org stamped by trigger).
- ☐ Existing admin task-review, add/view developer, project assignment all still work.
- ☐ Existing developer dashboard (projects, submissions, notifications) unchanged.

---

### Notes / known limits
- Server routes `developer/delete`, `admin-review`, `task-plan/*` still authorize by a
  caller-supplied `adminId` (not the JWT) — deeper hardening tracked separately.
- Migration apply + this QA both require project-owner access to
  Supabase `isaccqqjobuwfeaxlrwc`.
