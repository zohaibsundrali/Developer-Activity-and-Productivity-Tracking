-- =====================================================================
--  018 — Security hardening: real tenant isolation + role-scoped RLS
-- =====================================================================
--  Fixes audit findings C1, C3, C4, H1, H2, H6 and part of C10.
--
--  WHY THIS EXISTS
--   1. schema.sql created `FOR ALL USING (true)` policies with no TO clause
--      on five core tables. Postgres ORs permissive policies, so the
--      org_isolation policies added in 013/014 granted nothing — the
--      effective policy was `true`, for PUBLIC (which includes anon).
--      Verified empirically on postgres 16.
--   2. Every org_isolation policy is FOR ALL with no role predicate, so a
--      developer had the same database rights as the owner. The UI was the
--      only role gate, and it reads its role from sessionStorage.
--
--  FORMAT NOTE: one statement per physical line, no DO/$$ blocks — the
--  target SQL editor splits input on newlines and semicolons.
--
--  SAFETY: verified that no browser-side code writes to the tracking
--  tables, activity_logs or admin_reviews (all writes go through
--  service-role API routes, which bypass RLS). Browser writes to
--  memberships/organizations/employee_profiles happen only in owner/admin/hr
--  surfaces, which the new policies still permit.
--
--  Depends on 010-017. Helpers used: auth_org(), auth_role(),
--  auth_is_client(), auth_app_user_id() (012 + 014).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Remove the legacy permissive policies that nullified org isolation
-- ---------------------------------------------------------------------
drop policy if exists "Allow all access to developer_tasks" on public.developer_tasks;
drop policy if exists "Allow all access to task_submissions" on public.task_submissions;
drop policy if exists "Allow all access to productivity_metrics" on public.productivity_metrics;
drop policy if exists "Allow all access to activity_logs" on public.activity_logs;
drop policy if exists "Allow all access to admin_reviews" on public.admin_reviews;

-- ---------------------------------------------------------------------
-- 2) activity_logs + admin_reviews never had an org policy at all.
--    Reads: org members (non-client). Writes: service-role routes only.
-- ---------------------------------------------------------------------
alter table public.activity_logs enable row level security;
drop policy if exists org_isolation on public.activity_logs;
drop policy if exists activity_logs_read on public.activity_logs;
create policy activity_logs_read on public.activity_logs for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());

alter table public.admin_reviews enable row level security;
drop policy if exists org_isolation on public.admin_reviews;
drop policy if exists admin_reviews_read on public.admin_reviews;
create policy admin_reviews_read on public.admin_reviews for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());

-- ---------------------------------------------------------------------
-- 3) memberships — anyone in the org may READ (names/roles power the
--    directory, boards and team panels), but only owner/admin/hr may
--    change them, and only an owner may grant or revoke the owner role.
--    This closes the self-promotion path (C3).
-- ---------------------------------------------------------------------
drop policy if exists org_isolation on public.memberships;
drop policy if exists memberships_read on public.memberships;
drop policy if exists memberships_insert on public.memberships;
drop policy if exists memberships_update on public.memberships;
drop policy if exists memberships_delete on public.memberships;
create policy memberships_read on public.memberships for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());
create policy memberships_insert on public.memberships for insert to authenticated with check (organization_id = public.auth_org() and public.auth_role() in ('owner','admin','hr') and (role <> 'owner' or public.auth_role() = 'owner'));
create policy memberships_update on public.memberships for update to authenticated using (organization_id = public.auth_org() and public.auth_role() in ('owner','admin','hr')) with check (organization_id = public.auth_org() and (role <> 'owner' or public.auth_role() = 'owner'));
create policy memberships_delete on public.memberships for delete to authenticated using (organization_id = public.auth_org() and public.auth_role() in ('owner','admin') and role <> 'owner');

-- ---------------------------------------------------------------------
-- 4) organizations — everyone in the org may read it; only owner/admin
--    may update it; nobody may delete it through the API (cascades).
-- ---------------------------------------------------------------------
drop policy if exists org_self on public.organizations;
drop policy if exists organizations_read on public.organizations;
drop policy if exists organizations_update on public.organizations;
create policy organizations_read on public.organizations for select to authenticated using (id = public.auth_org());
create policy organizations_update on public.organizations for update to authenticated using (id = public.auth_org() and public.auth_role() in ('owner','admin')) with check (id = public.auth_org());

-- ---------------------------------------------------------------------
-- 5) employee_profiles — PII. Readable by people-ops roles, or by the
--    employee themselves. Writable by people-ops roles only. (H1)
-- ---------------------------------------------------------------------
drop policy if exists org_isolation on public.employee_profiles;
drop policy if exists employee_profiles_read on public.employee_profiles;
drop policy if exists employee_profiles_write on public.employee_profiles;
drop policy if exists employee_profiles_update on public.employee_profiles;
drop policy if exists employee_profiles_delete on public.employee_profiles;
create policy employee_profiles_read on public.employee_profiles for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and (public.auth_role() in ('owner','admin','hr') or user_id = public.auth_app_user_id()));
create policy employee_profiles_write on public.employee_profiles for insert to authenticated with check (organization_id = public.auth_org() and public.auth_role() in ('owner','admin','hr'));
create policy employee_profiles_update on public.employee_profiles for update to authenticated using (organization_id = public.auth_org() and public.auth_role() in ('owner','admin','hr')) with check (organization_id = public.auth_org());
create policy employee_profiles_delete on public.employee_profiles for delete to authenticated using (organization_id = public.auth_org() and public.auth_role() in ('owner','admin','hr'));

-- ---------------------------------------------------------------------
-- 6) automation_rules — rules execute against other people's tasks, so
--    only owner/admin may see or change them. (H5)
-- ---------------------------------------------------------------------
drop policy if exists org_isolation on public.automation_rules;
drop policy if exists automation_rules_all on public.automation_rules;
create policy automation_rules_all on public.automation_rules for all to authenticated using (organization_id = public.auth_org() and public.auth_role() in ('owner','admin')) with check (organization_id = public.auth_org() and public.auth_role() in ('owner','admin'));

-- ---------------------------------------------------------------------
-- 7) pm_activity — an audit feed. Append-only: no update or delete policy
--    exists, so those commands are denied for every authenticated user. (H2)
-- ---------------------------------------------------------------------
drop policy if exists org_isolation on public.pm_activity;
drop policy if exists pm_activity_read on public.pm_activity;
drop policy if exists pm_activity_insert on public.pm_activity;
create policy pm_activity_read on public.pm_activity for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());
create policy pm_activity_insert on public.pm_activity for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());

-- ---------------------------------------------------------------------
-- 8) task_comments — everyone in the org can read and post; you may only
--    edit or delete your own comment (owner/admin/manager can moderate). (H2)
-- ---------------------------------------------------------------------
drop policy if exists org_isolation on public.task_comments;
drop policy if exists task_comments_read on public.task_comments;
drop policy if exists task_comments_insert on public.task_comments;
drop policy if exists task_comments_update on public.task_comments;
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_read on public.task_comments for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());
create policy task_comments_insert on public.task_comments for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
create policy task_comments_update on public.task_comments for update to authenticated using (organization_id = public.auth_org() and (author_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin','manager'))) with check (organization_id = public.auth_org());
create policy task_comments_delete on public.task_comments for delete to authenticated using (organization_id = public.auth_org() and (author_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin','manager')));

-- ---------------------------------------------------------------------
-- 9) task_time_logs — billable time. Everyone in the org can read (reports
--    need it), but you may only log and edit your OWN time. (H2)
-- ---------------------------------------------------------------------
drop policy if exists org_isolation on public.task_time_logs;
drop policy if exists task_time_logs_read on public.task_time_logs;
drop policy if exists task_time_logs_insert on public.task_time_logs;
drop policy if exists task_time_logs_update on public.task_time_logs;
drop policy if exists task_time_logs_delete on public.task_time_logs;
create policy task_time_logs_read on public.task_time_logs for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());
create policy task_time_logs_insert on public.task_time_logs for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client() and (developer_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin')));
create policy task_time_logs_update on public.task_time_logs for update to authenticated using (organization_id = public.auth_org() and (developer_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin'))) with check (organization_id = public.auth_org());
create policy task_time_logs_delete on public.task_time_logs for delete to authenticated using (organization_id = public.auth_org() and (developer_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin')));

-- ---------------------------------------------------------------------
-- 10) Desktop-tracking tables — track_insert was `with check (true)` with
--     no TO clause, so the anon key could inject fabricated sessions,
--     keystrokes and screenshots into any tenant. The desktop app writes
--     through service-role API routes (which bypass RLS), and no browser
--     code inserts here, so restricting this to authenticated org members
--     breaks nothing. (H6)
-- ---------------------------------------------------------------------
drop policy if exists track_insert on public.productivity_sessions;
create policy track_insert on public.productivity_sessions for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists track_insert on public.keyboard_stats;
create policy track_insert on public.keyboard_stats for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists track_insert on public.mouse_activities;
create policy track_insert on public.mouse_activities for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists track_insert on public.app_usage;
create policy track_insert on public.app_usage for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists track_insert on public.screenshots;
create policy track_insert on public.screenshots for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists track_insert on public.developer_logins;
create policy track_insert on public.developer_logins for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists track_insert on public.developer_activities;
create policy track_insert on public.developer_activities for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());

-- =====================================================================
-- Verify after applying — all three should return zero rows:
--   select tablename, policyname from pg_policies where schemaname='public' and (qual='true' or qual is null);
--   select tablename, policyname, roles::text from pg_policies where schemaname='public' and roles::text like '%public%';
--   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname);
-- =====================================================================
