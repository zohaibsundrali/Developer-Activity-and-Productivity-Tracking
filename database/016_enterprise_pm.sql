-- =====================================================================
--  Enterprise Project Management — schema foundation (additive, non-breaking)
-- =====================================================================
--  Extends the existing projects / developer_tasks model with Agile PM
--  primitives (workspaces, sprints, epics, subtasks, dependencies, checklists,
--  comments, watchers, attachments, labels, custom fields, automation, saved
--  views) and a session↔task mapping for tracking integration.
--
--  Guarantees:
--   - Existing projects/developer_tasks/task-plan workflow untouched: ONLY
--     new nullable columns + new tables are added.
--   - All new tables are org-scoped, RLS = full org access for non-clients,
--     clients denied (same posture as memberships/employee_profiles).
--   - Desktop tracking tables are NOT altered; task linkage is via the new
--     additive `session_tasks` mapping.
--  Depends on 010–015 (auth_org, auth_is_client, stamp_org, projects,
--  developer_tasks, organizations, memberships).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Additive columns on existing tables (all nullable / defaulted)
-- ---------------------------------------------------------------------
alter table public.projects
  add column if not exists workspace_id  uuid,
  add column if not exists manager_id    uuid,                 -- a membership user_id
  add column if not exists priority      text default 'medium',-- low|medium|high|urgent
  add column if not exists start_date    date,
  add column if not exists end_date      date,
  add column if not exists budget        numeric(14,2),
  add column if not exists tags          text[] default '{}',
  add column if not exists archived      boolean default false,
  add column if not exists is_template   boolean default false;

alter table public.developer_tasks
  add column if not exists parent_task_id  uuid,               -- subtask → parent
  add column if not exists sprint_id       uuid,
  add column if not exists epic_id         uuid,
  add column if not exists priority        text default 'medium',
  add column if not exists story_points    integer,
  add column if not exists estimated_hours numeric(8,2),
  add column if not exists actual_hours    numeric(8,2),
  add column if not exists due_date        date,
  add column if not exists tags            text[] default '{}',
  add column if not exists labels          text[] default '{}',
  add column if not exists custom_fields   jsonb default '{}'::jsonb,
  add column if not exists position        numeric,            -- board/list ordering
  add column if not exists is_recurring    boolean default false,
  add column if not exists recurrence      jsonb default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 2) New PM tables
-- ---------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, description text, color text, icon text,
  created_by uuid, created_at timestamptz default now()
);

create table if not exists public.sprints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null, goal text,
  status text default 'planned' check (status in ('planned','active','completed')),
  start_date date, end_date date, sort_order integer default 0,
  created_by uuid, created_at timestamptz default now()
);

create table if not exists public.epics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null, description text, color text,
  status text default 'open' check (status in ('open','in_progress','done')),
  created_by uuid, created_at timestamptz default now()
);

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.developer_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.developer_tasks(id) on delete cascade,
  type text default 'blocks' check (type in ('blocks','blocked_by','relates_to')),
  created_at timestamptz default now(),
  unique (task_id, depends_on_task_id, type)
);

create table if not exists public.task_checklists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.developer_tasks(id) on delete cascade,
  text text not null, done boolean default false, sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.developer_tasks(id) on delete cascade,
  author_id uuid, author_type text, author_name text,
  body text not null,
  mentions uuid[] default '{}',          -- mentioned member user_ids
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_task_comments_task on public.task_comments(task_id);

create table if not exists public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.developer_tasks(id) on delete cascade,
  user_id uuid not null, user_type text, role text default 'watcher', -- watcher|reviewer
  created_at timestamptz default now(),
  unique (task_id, user_id, role)
);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.developer_tasks(id) on delete cascade,
  file_name text, file_path text, file_type text, file_size bigint,
  uploaded_by uuid, created_at timestamptz default now()
);

create table if not exists public.project_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null, color text default '#6C82FF',
  created_at timestamptz default now()
);

create table if not exists public.project_custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  field_type text default 'text' check (field_type in ('text','number','date','select','checkbox','user')),
  options jsonb default '[]'::jsonb, sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null, enabled boolean default true,
  trigger jsonb not null default '{}'::jsonb,   -- {event, from, to, ...}
  actions jsonb not null default '[]'::jsonb,    -- [{type, ...}]
  created_by uuid, created_at timestamptz default now()
);

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid, name text not null,
  view_type text default 'board' check (view_type in ('board','list','table','calendar','timeline','gantt','workload')),
  config jsonb default '{}'::jsonb, is_shared boolean default false,
  created_at timestamptz default now()
);

-- Tracking ↔ task linkage (additive; desktop tracking tables untouched).
-- Associates a tracked session (or time-slice) with a task so productivity,
-- keyboard/mouse/app/screenshot rows can be rolled up per task via session_id.
create table if not exists public.session_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id text,                      -- productivity_sessions.session_id
  task_id uuid references public.developer_tasks(id) on delete set null,
  developer_id uuid,
  started_at timestamptz default now(), ended_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_session_tasks_session on public.session_tasks(session_id);
create index if not exists idx_session_tasks_task on public.session_tasks(task_id);

create index if not exists idx_sprints_project on public.sprints(project_id);
create index if not exists idx_epics_project on public.epics(project_id);
create index if not exists idx_dev_tasks_parent on public.developer_tasks(parent_task_id);
create index if not exists idx_dev_tasks_sprint on public.developer_tasks(sprint_id);

-- ---------------------------------------------------------------------
-- 3) stamp_org trigger + RLS on all new tables (non-clients full org
--    access; clients denied — same as internal tables)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','sprints','epics','task_dependencies','task_checklists',
    'task_comments','task_watchers','task_attachments','project_labels',
    'project_custom_fields','automation_rules','saved_views','session_tasks'
  ] loop
    execute format('drop trigger if exists trg_stamp_org on public.%I', t);
    execute format('create trigger trg_stamp_org before insert on public.%I for each row execute function public.stamp_org()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format($f$create policy org_isolation on public.%I for all to authenticated
      using (organization_id = public.auth_org() and not public.auth_is_client())
      with check (organization_id = public.auth_org() and not public.auth_is_client())$f$, t);
  end loop;
end $$;

commit;

-- =====================================================================
-- Verify (optional):
--   select table_name from information_schema.tables where table_schema='public'
--     and table_name in ('sprints','epics','task_comments','session_tasks');
--   select column_name from information_schema.columns
--     where table_name='developer_tasks' and column_name in
--     ('parent_task_id','sprint_id','story_points','priority','due_date');
-- =====================================================================
