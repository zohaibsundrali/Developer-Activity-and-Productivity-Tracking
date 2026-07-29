# Team & Employee Management — E2E Test Checklist

Run after migration `015` is applied (done). App: `npm run dev` (current code is on
:3005 locally) or the live site once deployed. ☐ = to test.

Legend of what to watch: 🔴 = a hard isolation/permission guarantee.

---

## 0. Optional — verify migration 015 (read-only SQL)
```sql
-- new roles present?
select pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.memberships'::regclass and contype='c'
  and pg_get_constraintdef(oid) ilike '%team_lead%';           -- 1 row w/ team_lead + hr
-- new table + columns?
select column_name from information_schema.columns
where table_schema='public' and table_name='employee_profiles' order by 1;
select column_name from information_schema.columns
where table_schema='public' and table_name='memberships' and column_name='reports_to';  -- 1 row
```

## 1. New sections visible (Owner/Admin)
- ☐ Login as Owner/Admin → admin dashboard sidebar now shows **Employees** and **Team Stats**.
- ☐ Open **Employees** → directory loads (existing developers/admins appear, clients do NOT).
- ☐ Open **Team Stats** → headcount / role & department distribution / attendance / ranking render (may be sparse with little data — that's fine, no crash).

## 2. Employee profile editing (Phase 2/3)
- ☐ Employees → click **Edit** on a member. Set: designation, phone, address, a few **skills** (chips), employment status + type, **joining date**, **work schedule** (times + days), **bio**.
- ☐ Upload a **profile photo** → preview shows; Save → photo appears in the directory avatar.
  - If upload errors "bucket not found": the `documents` bucket must exist (it already does for org logos). 
- ☐ Change the member's **Role** (e.g. developer → team_lead), **Department**, **Team** → Save → directory reflects it.
- ☐ Re-open the same member → all saved values persist (proves employee_profiles upsert).

## 3. Reporting hierarchy + supervision (Phase 3)
- ☐ Edit an employee → set **Reports to** = a manager/team-lead → Save.
- ☐ Log in as that manager/team-lead (Team Member button) → staff dashboard → **Team** →
  **"Your direct reports"** shows that employee. 🔴 (only their reports, not everyone's).

## 4. Activate / deactivate + transfer (Phase 3)
- ☐ Employees → quick **Deactivate** a member → status badge → Suspended.
- ☐ **Activate** again → back to Active.
- ☐ **Transfer**: edit a member's Team/Department to a different one → Save → directory updates.

## 5. Directory search / filter / sort (Phase 2)
- ☐ Search by name/email/designation → list narrows.
- ☐ Filter by Role, Department, Team, Status (each) → correct subset.
- ☐ Sort by Name / Role / Recently joined → order changes.

## 6. HR role (per-role RBAC) 🔴
- ☐ Invite an **HR** (Organization → Invitations → role HR) → accept → login (Admin button).
- ☐ HR lands on the **admin dashboard** but sidebar shows ONLY: Overview, Add/View Developers,
  **Employees**, **Team Stats**, Organization. 🔴
- ☐ HR should NOT see: All Projects, Task Reviews, Developer Activity, Clients.
- ☐ HR types a blocked URL e.g. `/admin/dashboard?section=clients` → falls back to **Overview**. 🔴
- ☐ HR can edit an employee profile (manage_employees) — Save works.

## 7. Owner vs Admin (unchanged, re-verify)
- ☐ Owner → Organization → Settings editable. Admin → Settings **view-only** (lock banner).

## 8. No regression (existing must still work) 🔴
- ☐ Add Developer, View Developers, assign a project, Task Reviews, Developer Activity — all work.
- ☐ A **Client** logs in → still only their portal; sees NO employees/team/staff data. 🔴
- ☐ Desktop tracker still logs sessions/screenshots (org-stamped).
- ☐ Two orgs: Org A sees no Org B employees/teams/departments. 🔴

---

### Priority (if short on time): **#3** (direct reports), **#6** (HR nav lock + URL block), **#8** (client still isolated, no regression).

Report any ❌ with the screen/error and I'll fix it.
