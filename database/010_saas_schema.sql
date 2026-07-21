-- =====================================================================
--  SaaS Multi-Tenant — PHASE 0 (Part 1/2): SCHEMA (additive, non-breaking)
-- =====================================================================
--  Adds organization/workspace, membership, team, department, invitation
--  and role-permission entities, plus a NULLABLE organization_id on every
--  data table. Nothing is dropped or made NOT NULL, so the current system
--  keeps working unchanged. The desktop tracking app is unaffected
--  (org_id on tracking tables is nullable and set only by backfill/website).
--
--  Safe to run more than once (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--  Review, then run in the Supabase SQL editor. Run 011_saas_backfill.sql AFTER.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Core SaaS entities
-- ---------------------------------------------------------------------

create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique,
  logo_url      text,
  industry      text,
  company_size  text,
  country       text,
  timezone      text not null default 'UTC',
  owner_id      uuid references public.admin_users(id) on delete set null,
  -- working_hours, notification_preferences, security settings live here:
  settings      jsonb not null default '{}'::jsonb,
  status        text not null default 'active' check (status in ('active','suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.departments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  description      text,
  created_at       timestamptz not null default now()
);

create table if not exists public.teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  department_id    uuid references public.departments(id) on delete set null,
  name             text not null,
  -- manager_id references a membership.id (kept loose; users span two tables)
  manager_id       uuid,
  created_at       timestamptz not null default now()
);

-- memberships bridge the EXISTING two user tables (admin_users + developers)
-- via (user_id, user_type) so we don't have to merge them yet.
create table if not exists public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null,
  user_type        text not null check (user_type in ('admin','developer')),
  email            text,
  role             text not null default 'developer'
                   check (role in ('owner','admin','manager','developer','employee','client')),
  team_id          uuid references public.teams(id) on delete set null,
  department_id    uuid references public.departments(id) on delete set null,
  status           text not null default 'active' check (status in ('active','invited','suspended')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id, user_type)
);

create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            text not null,
  role             text not null default 'developer'
                   check (role in ('owner','admin','manager','developer','employee','client')),
  team_id          uuid references public.teams(id) on delete set null,
  department_id    uuid references public.departments(id) on delete set null,
  token            text not null unique,
  status           text not null default 'pending'
                   check (status in ('pending','accepted','expired','revoked')),
  invited_by       uuid,
  expires_at       timestamptz not null default (now() + interval '7 days'),
  created_at       timestamptz not null default now()
);

-- Fine-grained RBAC matrix (seeded with defaults in the backfill file).
create table if not exists public.role_permissions (
  id         uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('owner','admin','manager','developer','employee','client')),
  resource   text not null,   -- projects, tasks, developers, tracking, reports, settings, members, billing
  action     text not null,   -- view, create, update, delete, review, manage
  allowed    boolean not null default true,
  unique (role, resource, action)
);

-- ---------------------------------------------------------------------
-- 2) Add NULLABLE organization_id to existing tables (non-breaking)
-- ---------------------------------------------------------------------

-- Account tables
alter table public.admin_users        add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.developers         add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- Project / task / workflow tables
alter table public.projects           add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.developer_tasks    add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.task_submissions   add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.productivity_metrics add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.notifications      add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- These may or may not exist depending on the live DB; guarded with DO blocks.
do $$ begin
  if to_regclass('public.activity_logs') is not null then
    execute 'alter table public.activity_logs add column if not exists organization_id uuid';
  end if;
  if to_regclass('public.admin_reviews') is not null then
    execute 'alter table public.admin_reviews add column if not exists organization_id uuid';
  end if;
end $$;

-- Desktop-tracking tables: NULLABLE, NO foreign key (backward-compatible; the
-- desktop app is not being changed — the website derives/backfills org_id).
do $$
declare t text;
begin
  foreach t in array array[
    'productivity_sessions','keyboard_stats','mouse_activities',
    'app_usage','screenshots','developer_logins','browser_usage','developer_activities'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists organization_id uuid', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Indexes for org-scoped queries
-- ---------------------------------------------------------------------
create index if not exists idx_org_owner              on public.organizations(owner_id);
create index if not exists idx_memberships_org        on public.memberships(organization_id);
create index if not exists idx_memberships_user       on public.memberships(user_id, user_type);
create index if not exists idx_memberships_email      on public.memberships(lower(email));
create index if not exists idx_departments_org        on public.departments(organization_id);
create index if not exists idx_teams_org              on public.teams(organization_id);
create index if not exists idx_invitations_org        on public.invitations(organization_id);
create index if not exists idx_invitations_email      on public.invitations(lower(email));
create index if not exists idx_admin_users_org        on public.admin_users(organization_id);
create index if not exists idx_developers_org         on public.developers(organization_id);
create index if not exists idx_projects_org           on public.projects(organization_id);
create index if not exists idx_developer_tasks_org    on public.developer_tasks(organization_id);
create index if not exists idx_task_submissions_org   on public.task_submissions(organization_id);
create index if not exists idx_productivity_metrics_org on public.productivity_metrics(organization_id);
create index if not exists idx_notifications_org      on public.notifications(organization_id);

commit;

-- Done. Now run 011_saas_backfill.sql to create one organization per existing
-- admin and populate organization_id across all data.
