-- =====================================================================
--  Team & Employee Management — foundation (additive, non-breaking)
-- =====================================================================
--  Adds two new roles (team_lead, hr), a rich employee_profiles table, a
--  reporting-manager link, and a team-lead slot. Nothing here changes or
--  removes existing columns/rows; all existing admin/developer/client
--  behaviour is preserved. Depends on 010–014 (auth_org, auth_is_client,
--  stamp_org, organizations, memberships, teams, departments).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) New roles: team_lead + hr  → widen the role CHECK on the 3 tables
--    that constrain it (memberships, invitations, role_permissions).
--    We drop ONLY the role CHECK (identified by it mentioning 'manager',
--    which the user_type/status CHECKs never do) and re-add the 8-value set.
-- ---------------------------------------------------------------------
do $$
declare t text; c record;
begin
  foreach t in array array['memberships','invitations','role_permissions'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    for c in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' and rel.relname = t and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%manager%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format(
      $f$alter table public.%I add constraint %I
         check (role in ('owner','admin','manager','team_lead','developer','employee','hr','client'))$f$,
      t, t || '_role_check'
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Reporting hierarchy + team lead (loose uuid refs, like teams.manager_id,
--    because staff span admin_users + developers tables)
-- ---------------------------------------------------------------------
alter table public.memberships add column if not exists reports_to uuid;      -- another member's user_id
alter table public.teams       add column if not exists team_lead_id uuid;    -- a member's user_id

-- ---------------------------------------------------------------------
-- 3) Rich employee profile (one row per staff membership). Additive: the
--    existing `developers` table is untouched.
-- ---------------------------------------------------------------------
create table if not exists public.employee_profiles (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  membership_id     uuid references public.memberships(id) on delete cascade,
  user_id           uuid,                 -- developers.id / admin_users.id (matches memberships.user_id)
  user_type         text,                 -- 'developer' | 'admin'
  designation       text,                 -- job title
  phone             text,
  address           text,
  skills            text[] default '{}',
  employment_status text default 'active'
                    check (employment_status in ('active','on_leave','suspended','terminated')),
  employment_type   text
                    check (employment_type in ('full_time','part_time','contract','intern')),
  joining_date      date,
  work_schedule     jsonb default '{}'::jsonb,   -- {start,end,days:[...]}
  photo_url         text,
  bio               text,
  performance       jsonb default '{}'::jsonb,   -- cached rollups (optional)
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (organization_id, user_id, user_type)
);
create index if not exists idx_emp_profiles_org        on public.employee_profiles(organization_id);
create index if not exists idx_emp_profiles_membership on public.employee_profiles(membership_id);
create index if not exists idx_emp_profiles_user       on public.employee_profiles(user_id);

-- ---------------------------------------------------------------------
-- 4) org stamp + RLS (internal table: full org access for non-clients,
--    clients denied — same model as memberships/developers)
-- ---------------------------------------------------------------------
drop trigger if exists trg_stamp_org on public.employee_profiles;
create trigger trg_stamp_org before insert on public.employee_profiles
  for each row execute function public.stamp_org();

alter table public.employee_profiles enable row level security;
drop policy if exists org_isolation on public.employee_profiles;
create policy org_isolation on public.employee_profiles for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());

-- ---------------------------------------------------------------------
-- 5) Seed default permission rows for the two new roles (global matrix).
--    Mirrors the manager/employee posture; app-layer permissions.js is the
--    authoritative gate, this keeps role_permissions complete.
-- ---------------------------------------------------------------------
insert into public.role_permissions (role, resource, action, allowed)
select r.role, x.resource, x.action, x.allowed
from (values ('team_lead'), ('hr')) as r(role)
cross join (values
  ('projects','read', true),
  ('tasks','read', true),
  ('reports','read', true)
) as x(resource, action, allowed)
on conflict (role, resource, action) do nothing;

commit;

-- =====================================================================
-- After apply, run VERIFY_saas.sql style check or:
--   select unnest(enum_range(null))  -- n/a (CHECK, not enum)
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.memberships'::regclass and contype='c';
-- Expect the role check to list team_lead + hr.
-- =====================================================================
