# Phase 6 — True DB-Level Isolation (Supabase Auth + RLS) — MIGRATION PLAN

> Status: **PLAN ONLY — nothing in this document has been applied.** No DB, auth,
> or code changes were made. Review, then decide whether/how to proceed.

## 1. Goal
Move from **app-layer** organization isolation (Phases 1–5: every query filters by
`organization_id`) to **database-enforced** isolation via Row Level Security (RLS),
so that even a leaked anon key cannot read another organization's data.

## 2. Why this is a big, breaking phase
RLS can only isolate rows **per user** if the database knows *who* is asking — i.e.
every request must carry a **per-user JWT**. Today the whole app (and the desktop
app) use the **shared anon key** with **open RLS** (`USING(true)`), and auth is
**custom** (plaintext passwords compared in `login/page.js`). There is no JWT, so
RLS cannot scope anything. Therefore Phase 6 requires **three** coupled changes:

1. **Auth migration**: custom auth → **Supabase Auth** (real `auth.users`, JWT sessions).
2. **Query layer**: every Supabase call uses the **user's session** (JWT), not the anon key.
3. **RLS policies**: enable RLS + org-scoped policies on every table.

None of these can be done "half-way" — RLS without Supabase Auth does nothing.

## 3. The critical constraint — the DESKTOP APP
The same Supabase project + `developers` / tracking tables are used by the
**desktop tracking app**, which:
- **writes** tracking data (`productivity_sessions`, `keyboard_stats`,
  `mouse_activities`, `app_usage`, `screenshots`, `developer_logins`) with the **anon key**, no auth session;
- **(likely) reads** `developers` to authenticate a developer at login.

If we naively enable restrictive RLS, **the desktop app breaks** (writes rejected,
login read blocked). So the plan must keep the desktop app working.

### 🔎 Open question to confirm before coding
Does the desktop app **read the `developers` table** (with the anon key) to log a
developer in? 
- If **NO** (it only writes tracking data) → the desktop-safe strategy below works with **zero desktop changes**.
- If **YES** → either the desktop app must migrate to Supabase Auth too, or `developers` needs a permissive read path (weakens isolation on that one table).

## 4. Recommended strategy — "website authenticates, desktop keeps writing"
Split tables into two groups:

### Group A — Website-owned tables (full RLS)
`organizations, memberships, teams, departments, invitations, role_permissions,
developers, admin_users, projects, developer_tasks, task_submissions,
productivity_metrics, notifications, activity_logs, admin_reviews`
- Enable RLS with **org-scoped** SELECT/INSERT/UPDATE/DELETE policies.
- The website will be **authenticated** (Supabase Auth JWT carrying `organization_id`),
  so it passes these policies; the anon key alone sees nothing.

### Group B — Desktop-written tracking tables (asymmetric RLS)
`productivity_sessions, keyboard_stats, mouse_activities, app_usage, screenshots,
developer_logins, browser_usage, developer_activities`
- **INSERT policy: permissive** (`WITH CHECK (true)`) → the desktop app keeps
  inserting with the anon key, **unchanged**.
- **SELECT policy: org-scoped** (`USING (organization_id = auth_org())`) → the
  website (authenticated) reads only its org's rows; the anon key reads nothing.
- New desktop rows arrive with `organization_id = NULL`; a lightweight **DB trigger**
  backfills `organization_id` from the developer on insert (via `developer_id`/email
  → `developers.organization_id`), so website reads stay correct with no desktop change.

This keeps the desktop app **100% untouched** (assuming it does not read `developers`
for login — see the open question).

## 5. Auth migration detail
- **Create Supabase Auth users** for every existing `admin_users` + `developers`
  row using the Admin API (`auth.admin.createUser({ email, password, email_confirm:true })`).
  Passwords are currently plaintext, so we can set them directly — **users keep their
  passwords, no forced reset**.
- Add `auth_user_id uuid` to `admin_users` and `developers`; populate it with the new
  auth user id (identity link).
- **Org claim in the JWT**: add a **Custom Access Token Hook** that injects
  `organization_id`, `role`, and `user_type` into every issued JWT (read from
  `memberships`). RLS policies then use `auth.jwt() ->> 'organization_id'`.
- Helper SQL: `create function auth_org() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'organization_id','')::uuid $$;`

## 6. Query-layer changes (website code)
- `login/page.js` / `registration` / `invite/[token]`: replace the plaintext
  `verifyPassword` + direct table read with `supabase.auth.signInWithPassword` /
  `signUp`, then load org context from the session.
- `supabaseClient.js`: already `persistSession:true`; ensure the authenticated
  session is used for all queries (it will be, once login uses Supabase Auth).
- The existing `.eq('organization_id', orgId)` app-layer filters **stay** (defence in
  depth) — RLS becomes the enforcing layer beneath them.

## 7. RLS policy preview (illustrative — NOT applied)
```sql
-- helper
create or replace function public.auth_org() returns uuid
  language sql stable as $$ select nullif(auth.jwt() ->> 'organization_id','')::uuid $$;

-- Group A example (projects): full org isolation
alter table public.projects enable row level security;
create policy org_select on public.projects for select
  using (organization_id = public.auth_org());
create policy org_write on public.projects for all
  using (organization_id = public.auth_org())
  with check (organization_id = public.auth_org());

-- Group B example (keyboard_stats): desktop writes, website org-reads
alter table public.keyboard_stats enable row level security;
create policy anon_insert on public.keyboard_stats for insert with check (true);
create policy org_read on public.keyboard_stats for select
  using (organization_id = public.auth_org());

-- trigger to stamp org on new desktop rows
create or replace function public.stamp_org_from_developer() returns trigger
  language plpgsql as $$
begin
  if new.organization_id is null then
    select d.organization_id into new.organization_id from public.developers d
     where d.id::text = new.developer_id::text
        or lower(d.email) = lower(coalesce(new.user_email, new.developer_email));
  end if;
  return new;
end $$;
```

## 8. Rollout order (safe, reversible per step)
1. Create auth users + `auth_user_id` links (additive, no behaviour change).
2. Add the custom access-token hook (org claim in JWT).
3. Switch website login/registration/invite to Supabase Auth (behind a test pass).
4. Add the org-stamp trigger on tracking tables (additive).
5. Enable RLS **table by table**, Group A first, verifying the website after each.
6. Enable Group B (asymmetric) last; verify desktop inserts + website reads.
7. Keep a documented **rollback** (disable RLS per table; revert login) at each step.

## 9. Risk register
| Risk | Mitigation |
|---|---|
| Desktop app writes rejected | Group B permissive INSERT; do not touch desktop app |
| Desktop reads `developers` for login | CONFIRM first; if yes, add a scoped read path or migrate desktop auth |
| Website-wide breakage during auth swap | Table-by-table RLS + staging test with 2 orgs before flipping |
| Password migration | Set existing plaintext passwords into Supabase Auth (no reset) |
| Lost org context in JWT | Custom access-token hook tested before enabling RLS |

## 10. Effort estimate
- Auth migration + hook: medium
- Login/registration/invite rewrite: medium
- RLS policies + triggers (all tables): medium
- Full multi-org + desktop regression testing: **the largest part**

## 11. Decision needed before any coding
1. Confirm the **desktop-app `developers` read** question (Section 3).
2. Approve the **asymmetric Group B** strategy (or choose full desktop migration).
3. Approve migrating existing users into **Supabase Auth keeping current passwords**.
4. Confirm we proceed **step-by-step with a test + rollback gate** at each table.
