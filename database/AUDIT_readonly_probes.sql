-- ============================================================================
-- READ-ONLY AUDIT PROBES  —  2026-08-31
--
-- Every statement here is a SELECT. Nothing is created, altered, or deleted.
-- Run the whole file in the Supabase SQL editor and paste the output back.
--
-- These answer the questions static code analysis CANNOT: what the database
-- actually enforces, as opposed to what the application believes it enforces.
-- ============================================================================

-- 1. RLS COVERAGE. A table with rls_enabled=false is readable by anyone
--    holding the anon key, regardless of what the API layer checks. A table
--    with rls_enabled=true and policy_count=0 is the opposite failure: it
--    denies everyone, and the feature on top of it is silently dead.
select c.relname                as table_name,
       c.relrowsecurity         as rls_enabled,
       count(p.polname)         as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by 1, 2
order by c.relrowsecurity asc, count(p.polname) asc, c.relname;

-- 2. POLICIES THAT ARE NOT ACTUALLY RESTRICTIVE. `using (true)` on a SELECT
--    policy means the row filter passes for every caller — the policy exists,
--    so it looks covered in an audit, and it enforces nothing.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true' or qual is null)
order by tablename, policyname;

-- 3. TABLES MISSING A TENANT COLUMN. In a multi-tenant system every row-owning
--    table needs organization_id; one that lacks it cannot be scoped by RLS at
--    all and has to be scoped by a join, which is easy to forget.
select t.table_name
from information_schema.tables t
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  and not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.table_name
      and c.column_name in ('organization_id', 'org_id')
  )
order by 1;

-- 4. SECURITY DEFINER FUNCTIONS. These run as their owner and bypass RLS.
--    Each one is a deliberate hole; the question is whether each still needs
--    to be one, and whether it sets a safe search_path (an unqualified
--    search_path on a SECURITY DEFINER function is a privilege-escalation
--    vector).
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                                as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '(no search_path set)') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;

-- 5. THE PERMISSION CATALOGUE, as the database currently holds it. Compare the
--    counts against src/utils/permissionCatalogue.js — migration 068 wrote 160
--    rows over 51 keys. A drift here means the UI and the database disagree
--    about who can do what.
select count(*) as total_rows,
       count(distinct permission_key) as distinct_keys,
       count(distinct role) as distinct_roles
from role_permissions;

-- 6. PER-USER OVERRIDES actually in force. Every row here is a person whose
--    access differs from their role, which is exactly the thing that will not
--    be obvious to whoever debugs it later.
select count(*) as override_rows from user_permissions;
select up.permission_key, up.granted, count(*) as people
from user_permissions up group by 1, 2 order by 1;

-- 7. ORPHANED MEMBERSHIPS. A membership whose auth_user_id is null cannot be
--    matched to a JWT, so that person is locked out; one whose user no longer
--    exists is a dangling grant.
select count(*) filter (where auth_user_id is null) as null_auth_user_id,
       count(*) filter (where reports_to is null)   as null_reports_to,
       count(*)                                     as total_memberships
from memberships;

-- 8. STORAGE EXPOSURE. A public bucket serves every object to anyone with the
--    URL, no token required — for a product that stores SCREENSHOTS of staff
--    machines, that is the highest-consequence single setting in the project.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets order by name;

select count(*) as storage_policies from pg_policies
where schemaname = 'storage' and tablename = 'objects';

-- 9. ANONYMOUS GRANTS. Anything granted to `anon` beyond what PostgREST needs
--    is reachable without logging in at all.
select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'public')
order by table_name, privilege_type;

-- 10. DATA-INTEGRITY SPOT CHECKS. Each of these should return zero.
select
  (select count(*) from developer_tasks where organization_id is null)      as tasks_without_org,
  (select count(*) from task_time_logs  where seconds < 0)                  as negative_time,
  (select count(*) from task_time_logs  where ended_at is null)             as running_timers,
  (select count(*) from projects        where organization_id is null)      as projects_without_org;

-- ============================================================================
-- 11. VERIFICATION FOR THE TWO CRITICAL FINDINGS  (still SELECT-only)
-- ============================================================================

-- 11a. Is the memberships UPDATE policy really as permissive as migration 018
--      declares? If `hr` appears in the USING clause and the WITH CHECK blocks
--      only the 'owner' role, then any HR member can write their own row to
--      role='admin' straight through PostgREST with the anon key — the API
--      route that guards this is a convention, not a control.
select policyname, cmd, qual as using_clause, with_check
from pg_policies
where schemaname = 'public' and tablename = 'memberships'
order by policyname;

-- 11b. How many people currently hold a role that could use that path?
select role, count(*) from memberships
where role in ('hr','admin','owner') group by role order by role;

-- 11c. THE PRECONDITION FOR THE CROSS-TENANT TAKEOVER. The attack needs a
--      membership row whose email has NO Supabase Auth account yet. If this
--      returns 0, the second critical is not currently exploitable — the
--      population is what makes it live, and it is the same number
--      /api/admin/legacy-auth-audit was built to watch.
select count(*) as memberships_with_no_auth_account
from memberships m
where m.auth_user_id is null
  and not exists (
    select 1 from auth.users u
    where lower(btrim(u.email)) = lower(btrim(m.email))
  );

-- 11d. Duplicate emails ACROSS organizations. Each one is a row where the
--      unscoped `ilike` lookup in repair-claims has more than one candidate.
select lower(btrim(email)) as email,
       count(distinct organization_id) as orgs,
       count(*) as membership_rows
from memberships
group by 1 having count(distinct organization_id) > 1
order by 2 desc;

-- 11e. THE LEGACY PUBLIC SCREENSHOT BUCKET. If a bucket named 'screenshots'
--      exists with public=true, every capture in it is readable by URL with no
--      token, keyed by the employee's email local-part — guessable. This is
--      staff-surveillance imagery, so it is the highest-consequence row in
--      this whole file.
select id, name, public from storage.buckets where name in ('screenshots','documents','monitoring');
select count(*) as legacy_screenshot_objects from storage.objects where bucket_id = 'screenshots';
