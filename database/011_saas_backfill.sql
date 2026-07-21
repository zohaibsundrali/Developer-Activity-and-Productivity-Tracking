-- =====================================================================
--  SaaS Multi-Tenant — PHASE 0 (Part 2/2): DATA BACKFILL
-- =====================================================================
--  Creates ONE organization per existing admin, makes each admin the Owner,
--  and populates organization_id across all data based on the current
--  added_by / created_by / assigned relationships. Idempotent and safe to
--  re-run (guards on organization_id IS NULL / ON CONFLICT DO NOTHING).
--
--  Run AFTER 010_saas_schema.sql. Review first; this touches production data.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) One organization per admin (name = company, else "<full name>'s Organization")
-- ---------------------------------------------------------------------
insert into public.organizations (name, owner_id, timezone)
select
  coalesce(nullif(trim(a.company), ''), nullif(trim(a.full_name), '') || '''s Organization', 'Organization'),
  a.id,
  'UTC'
from public.admin_users a
where not exists (select 1 from public.organizations o where o.owner_id = a.id);

-- Link each admin to the org they own
update public.admin_users a
set organization_id = o.id
from public.organizations o
where o.owner_id = a.id
  and a.organization_id is null;

-- ---------------------------------------------------------------------
-- 2) Owner memberships for admins
-- ---------------------------------------------------------------------
insert into public.memberships (organization_id, user_id, user_type, email, role, status)
select o.id, a.id, 'admin', a.email, 'owner', 'active'
from public.admin_users a
join public.organizations o on o.owner_id = a.id
on conflict (organization_id, user_id, user_type) do nothing;

-- ---------------------------------------------------------------------
-- 3) Developers -> organization of the admin who added them
-- ---------------------------------------------------------------------
update public.developers d
set organization_id = a.organization_id
from public.admin_users a
where d.organization_id is null
  and a.organization_id is not null
  and (d.added_by = a.id or lower(d.added_by_admin) = lower(a.email));

-- Developer memberships (role = developer)
insert into public.memberships (organization_id, user_id, user_type, email, role, status)
select d.organization_id, d.id, 'developer', d.email, 'developer', 'active'
from public.developers d
where d.organization_id is not null
on conflict (organization_id, user_id, user_type) do nothing;

-- ---------------------------------------------------------------------
-- 4) Projects -> organization of creator admin (fallbacks: added_by, assigned dev)
-- ---------------------------------------------------------------------
update public.projects p
set organization_id = a.organization_id
from public.admin_users a
where p.organization_id is null
  and a.organization_id is not null
  and (p.created_by = a.id or p.added_by = a.id or lower(p.added_by_admin) = lower(a.email));

update public.projects p
set organization_id = d.organization_id
from public.developers d
where p.organization_id is null
  and d.organization_id is not null
  and p.assigned_developer_id = d.id;

-- ---------------------------------------------------------------------
-- 5) developer_tasks / task_submissions -> org via their project
-- ---------------------------------------------------------------------
update public.developer_tasks t
set organization_id = p.organization_id
from public.projects p
where t.organization_id is null and t.project_id = p.id and p.organization_id is not null;

update public.task_submissions s
set organization_id = p.organization_id
from public.projects p
where s.organization_id is null and s.project_id = p.id and p.organization_id is not null;

-- ---------------------------------------------------------------------
-- 6) productivity_metrics -> org via developer
-- ---------------------------------------------------------------------
update public.productivity_metrics m
set organization_id = d.organization_id
from public.developers d
where m.organization_id is null and m.developer_id = d.id and d.organization_id is not null;

-- ---------------------------------------------------------------------
-- 7) notifications -> org via admin, then via developer
-- ---------------------------------------------------------------------
update public.notifications n
set organization_id = a.organization_id
from public.admin_users a
where n.organization_id is null and n.admin_id::text = a.id::text and a.organization_id is not null;

update public.notifications n
set organization_id = d.organization_id
from public.developers d
where n.organization_id is null
  and d.organization_id is not null
  and (n.developer_id::text = d.id::text or n.assigned_developer_id::text = d.id::text);

-- ---------------------------------------------------------------------
-- 8) Desktop-tracking tables -> org via developer (best-effort, guarded).
--    Backward-compatible: the desktop app is NOT changed; these are only
--    backfilled for existing rows. New desktop writes leave org_id NULL and
--    the website resolves org via developers.organization_id.
-- ---------------------------------------------------------------------
-- keyboard_stats (developer_id + user_email)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='keyboard_stats' and column_name='developer_id') then
    update public.keyboard_stats k set organization_id = d.organization_id
    from public.developers d
    where k.organization_id is null and k.developer_id::text = d.id::text and d.organization_id is not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='keyboard_stats' and column_name='user_email') then
    update public.keyboard_stats k set organization_id = d.organization_id
    from public.developers d
    where k.organization_id is null and lower(k.user_email) = lower(d.email) and d.organization_id is not null;
  end if;
end $$;

-- mouse_activities (developer_id)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='mouse_activities' and column_name='developer_id') then
    update public.mouse_activities x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and x.developer_id::text = d.id::text and d.organization_id is not null;
  end if;
end $$;

-- screenshots (developer_id + developer_email)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='screenshots' and column_name='developer_id') then
    update public.screenshots x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and x.developer_id::text = d.id::text and d.organization_id is not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='screenshots' and column_name='developer_email') then
    update public.screenshots x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and lower(x.developer_email) = lower(d.email) and d.organization_id is not null;
  end if;
end $$;

-- productivity_sessions (user_id + user_email)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='productivity_sessions' and column_name='user_id') then
    update public.productivity_sessions x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and x.user_id::text = d.id::text and d.organization_id is not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='productivity_sessions' and column_name='user_email') then
    update public.productivity_sessions x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and lower(x.user_email) = lower(d.email) and d.organization_id is not null;
  end if;
end $$;

-- app_usage (user_email)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='app_usage' and column_name='user_email') then
    update public.app_usage x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and lower(x.user_email) = lower(d.email) and d.organization_id is not null;
  end if;
end $$;

-- developer_logins (developer_id / developer_email / user_email / email — whichever exists)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='developer_logins' and column_name='developer_id') then
    update public.developer_logins x set organization_id = d.organization_id
    from public.developers d
    where x.organization_id is null and x.developer_id::text = d.id::text and d.organization_id is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9) Seed default RBAC matrix (role_permissions)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role, resource, action, allowed) values
  -- owner: full control
  ('owner','organization','manage',true),('owner','members','manage',true),('owner','billing','manage',true),
  ('owner','projects','manage',true),('owner','tasks','manage',true),('owner','developers','manage',true),
  ('owner','tracking','view',true),('owner','reports','view',true),('owner','settings','manage',true),
  -- admin: manage everything except org/billing deletion
  ('admin','members','manage',true),('admin','projects','manage',true),('admin','tasks','manage',true),
  ('admin','developers','manage',true),('admin','tracking','view',true),('admin','reports','view',true),
  ('admin','settings','manage',true),
  -- manager: run their teams' work
  ('manager','projects','view',true),('manager','projects','update',true),('manager','tasks','manage',true),
  ('manager','tasks','review',true),('manager','tracking','view',true),('manager','reports','view',true),
  ('manager','members','view',true),
  -- developer: do the work
  ('developer','projects','view',true),('developer','tasks','view',true),('developer','tasks','update',true),
  ('developer','tasks','create',true),('developer','tracking','view',true),
  -- employee: lighter contributor
  ('employee','projects','view',true),('employee','tasks','view',true),('employee','tracking','view',true),
  -- client: read-only visibility
  ('client','projects','view',true),('client','reports','view',true)
on conflict (role, resource, action) do nothing;

commit;

-- =====================================================================
--  VERIFY (run these SELECTs after; all data-table rows should have org_id):
--    select count(*) as orgs from public.organizations;                 -- expect 4
--    select count(*) from public.memberships;                           -- admins + developers
--    select count(*) from public.developers  where organization_id is null;  -- expect 0
--    select count(*) from public.projects    where organization_id is null;  -- expect 0
--    select count(*) from public.developer_tasks where organization_id is null; -- expect 0
--  Any leftover NULLs = rows whose owner couldn't be resolved; report them.
-- =====================================================================
