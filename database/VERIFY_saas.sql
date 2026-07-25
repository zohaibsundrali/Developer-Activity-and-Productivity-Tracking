-- =====================================================================
-- VERIFY_saas.sql  —  READ-ONLY health check for the SaaS + Client Portal
-- ---------------------------------------------------------------------
-- Safe to run any time: it makes NO changes. Run it in the Supabase SQL
-- editor AFTER applying migrations 010 → 011 → 012 → 013 → 014 (in order).
-- Every row should show ✅. Any ❌ tells you which migration didn't take.
-- =====================================================================

with checks as (
  -- ---- Core SaaS tables (010) --------------------------------------
  select 'table'  as kind, 'organizations'      as name, to_regclass('public.organizations')      is not null as present
  union all select 'table','memberships',        to_regclass('public.memberships')        is not null
  union all select 'table','departments',        to_regclass('public.departments')        is not null
  union all select 'table','teams',              to_regclass('public.teams')              is not null
  union all select 'table','role_permissions',   to_regclass('public.role_permissions')   is not null
  union all select 'table','invitations',        to_regclass('public.invitations')        is not null

  -- ---- Client-portal tables (014) ----------------------------------
  union all select 'table','clients',            to_regclass('public.clients')            is not null
  union all select 'table','project_clients',    to_regclass('public.project_clients')    is not null
  union all select 'table','milestones',         to_regclass('public.milestones')         is not null
  union all select 'table','announcements',      to_regclass('public.announcements')      is not null
  union all select 'table','project_updates',    to_regclass('public.project_updates')    is not null
  union all select 'table','approvals',          to_regclass('public.approvals')          is not null
  union all select 'table','support_threads',    to_regclass('public.support_threads')    is not null
  union all select 'table','support_messages',   to_regclass('public.support_messages')   is not null
  union all select 'table','invoices',           to_regclass('public.invoices')           is not null

  -- ---- RLS helper functions (012 + 014) ----------------------------
  union all select 'function','auth_org',                exists(select 1 from pg_proc where proname='auth_org')
  union all select 'function','auth_role',               exists(select 1 from pg_proc where proname='auth_role')
  union all select 'function','auth_user_type',          exists(select 1 from pg_proc where proname='auth_user_type')
  union all select 'function','auth_app_user_id',        exists(select 1 from pg_proc where proname='auth_app_user_id')
  union all select 'function','auth_is_client',          exists(select 1 from pg_proc where proname='auth_is_client')
  union all select 'function','auth_client_project_ids', exists(select 1 from pg_proc where proname='auth_client_project_ids')
  union all select 'function','stamp_org',               exists(select 1 from pg_proc where proname='stamp_org')

  -- ---- organization_id columns on core + tracking tables (010) -----
  union all select 'column','projects.organization_id',           exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects'           and column_name='organization_id')
  union all select 'column','developer_tasks.organization_id',    exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_tasks'    and column_name='organization_id')
  union all select 'column','task_submissions.organization_id',   exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_submissions'   and column_name='organization_id')
  union all select 'column','productivity_metrics.organization_id',exists(select 1 from information_schema.columns where table_schema='public' and table_name='productivity_metrics' and column_name='organization_id')
  union all select 'column','notifications.organization_id',      exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications'      and column_name='organization_id')
  union all select 'column','admin_users.organization_id',        exists(select 1 from information_schema.columns where table_schema='public' and table_name='admin_users'        and column_name='organization_id')
  union all select 'column','developers.organization_id',         exists(select 1 from information_schema.columns where table_schema='public' and table_name='developers'         and column_name='organization_id')
  union all select 'column','invitations.project_id',             exists(select 1 from information_schema.columns where table_schema='public' and table_name='invitations'        and column_name='project_id')

  -- ---- memberships.user_type allows 'client' (014) -----------------
  union all select 'check','memberships.user_type allows client',
    exists(
      select 1 from pg_constraint c
      where c.conrelid = 'public.memberships'::regclass
        and pg_get_constraintdef(c.oid) ilike '%user_type%'
        and pg_get_constraintdef(c.oid) ilike '%client%'
    )

  -- ---- Org-isolation RLS policies (013) ----------------------------
  union all select 'policy','projects.org_isolation',         exists(select 1 from pg_policies where schemaname='public' and tablename='projects'         and policyname='org_isolation')
  union all select 'policy','developer_tasks.org_isolation',  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_tasks'  and policyname='org_isolation')
  union all select 'policy','task_submissions.org_isolation', exists(select 1 from pg_policies where schemaname='public' and tablename='task_submissions' and policyname='org_isolation')
  union all select 'policy','memberships.org_isolation',      exists(select 1 from pg_policies where schemaname='public' and tablename='memberships'      and policyname='org_isolation')

  -- ---- Tracking read policy excludes clients (013 + 014) -----------
  union all select 'policy','screenshots.track_read',   exists(select 1 from pg_policies where schemaname='public' and tablename='screenshots'   and policyname='track_read')
  union all select 'policy','keyboard_stats.track_read',exists(select 1 from pg_policies where schemaname='public' and tablename='keyboard_stats'and policyname='track_read')

  -- ---- Client SELECT policies (014) --------------------------------
  union all select 'policy','invoices client policy', exists(select 1 from pg_policies where schemaname='public' and tablename='invoices')
  union all select 'policy','milestones client policy',exists(select 1 from pg_policies where schemaname='public' and tablename='milestones')
)
select
  kind,
  name,
  case when present then '✅' else '❌ MISSING' end as status
from checks
order by present asc, kind, name;

-- Expected: zero rows with ❌.  Also useful:
--   select tablename, count(*) policies from pg_policies where schemaname='public' group by 1 order by 1;
