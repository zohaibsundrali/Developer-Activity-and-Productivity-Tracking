-- =====================================================================
--  PM Advanced — task types, activity feed, per-task time logs,
--  wider notification categories (additive, non-breaking)
-- =====================================================================
--  Builds on 016. Everything here is either a new nullable/defaulted column,
--  a brand-new table, or a WIDENING of an existing CHECK (never a narrowing).
--
--  Guarantees:
--   - developer_tasks.status pipeline is UNTOUCHED.
--   - Desktop tracking tables are NOT altered.
--   - Existing task submit/review/approve flow keeps working unchanged.
--   - All new tables org-scoped: non-clients full org access, clients denied
--     (same posture as memberships / employee_profiles / the 016 PM tables).
--  Depends on 010-016 (auth_org, auth_is_client, stamp_org, developer_tasks,
--  projects, organizations, notifications).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Task types (Feature / Bug / Improvement / Research / Documentation
--    / Story). Additive, defaulted — existing rows become 'feature'.
--    'story' represents a Jira user story (typically linked to an epic).
-- ---------------------------------------------------------------------
alter table public.developer_tasks
  add column if not exists task_type text default 'feature';

-- Idempotent re-run safe: drop-if-exists then add (no PL/pgSQL needed).
alter table public.developer_tasks
  drop constraint if exists developer_tasks_task_type_check;
alter table public.developer_tasks
  add constraint developer_tasks_task_type_check
  check (task_type in ('feature','bug','improvement','research','documentation','story'));

-- ---------------------------------------------------------------------
-- 2) Generic PM activity feed (task history + project activity timeline).
--    One append-only row per meaningful change. entity_type tells you what
--    was touched; meta carries the diff / details.
-- ---------------------------------------------------------------------
create table if not exists public.pm_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid,                       -- loose ref (project may be filtered by RLS org anyway)
  entity_type text not null,              -- 'task' | 'project' | 'sprint' | 'epic' | 'comment' | ...
  entity_id   uuid,
  action      text not null,              -- 'created' | 'status_changed' | 'assigned' | 'commented' | ...
  actor_id    uuid,
  actor_name  text,
  meta        jsonb default '{}'::jsonb,   -- {from, to, field, value, ...}
  created_at  timestamptz default now()
);
create index if not exists idx_pm_activity_project on public.pm_activity(project_id);
create index if not exists idx_pm_activity_entity  on public.pm_activity(entity_type, entity_id);
create index if not exists idx_pm_activity_created on public.pm_activity(created_at desc);

-- ---------------------------------------------------------------------
-- 3) Per-task time logs (web start/stop timer today; a landing spot the
--    desktop app can feed later). Never touches the tracking tables.
-- ---------------------------------------------------------------------
create table if not exists public.task_time_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id      uuid references public.developer_tasks(id) on delete cascade,
  project_id   uuid,
  developer_id uuid,                      -- membership user_id / developers.id
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  seconds      integer,                   -- filled on stop (ended_at - started_at)
  source       text default 'web_timer',  -- 'web_timer' | 'desktop' | 'manual'
  note         text,
  created_at   timestamptz default now()
);
create index if not exists idx_time_logs_task on public.task_time_logs(task_id);
create index if not exists idx_time_logs_dev  on public.task_time_logs(developer_id);
create index if not exists idx_time_logs_proj on public.task_time_logs(project_id);

-- ---------------------------------------------------------------------
-- 4) Widen notification categories — plain SQL (no PL/pgSQL, so SQL editors
--    that split on ';' can't break it). The old inline CHECK blocked new
--    types AND was violated by an existing production value, so we simply
--    DROP the restrictive check; the app layer validates `type`. (A widened
--    CHECK can be re-added later once the legacy values are reconciled.)
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;

-- ---------------------------------------------------------------------
-- 5) stamp_org trigger + RLS on the two new tables (non-clients full org
--    access; clients denied — identical posture to the 016 PM tables).
--    Written out per-table as plain SQL (no DO loop).
-- ---------------------------------------------------------------------
drop trigger if exists trg_stamp_org on public.pm_activity;
create trigger trg_stamp_org before insert on public.pm_activity
  for each row execute function public.stamp_org();
alter table public.pm_activity enable row level security;
drop policy if exists org_isolation on public.pm_activity;
create policy org_isolation on public.pm_activity for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());

drop trigger if exists trg_stamp_org on public.task_time_logs;
create trigger trg_stamp_org before insert on public.task_time_logs
  for each row execute function public.stamp_org();
alter table public.task_time_logs enable row level security;
drop policy if exists org_isolation on public.task_time_logs;
create policy org_isolation on public.task_time_logs for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());

commit;

-- =====================================================================
-- Verify (optional):
--   select column_name from information_schema.columns
--     where table_name='developer_tasks' and column_name='task_type';
--   select table_name from information_schema.tables where table_schema='public'
--     and table_name in ('pm_activity','task_time_logs');
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid='public.notifications'::regclass and conname='notifications_type_check';
-- =====================================================================
