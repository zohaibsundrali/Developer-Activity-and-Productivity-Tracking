-- =====================================================================
--  Client Portal — Phase 0 foundation (additive, non-breaking)
-- =====================================================================
--  Adds a CLIENT user type that can only see the projects explicitly
--  linked to them, and the client-facing feature tables (milestones,
--  announcements, approvals, project updates, support, invoices).
--
--  Guarantees:
--   - Nothing here changes admin/developer behaviour. Existing
--     org_isolation policies are only tightened to EXCLUDE clients, so
--     admins/developers keep full org access exactly as before.
--   - Desktop tracking stays untouched (service_role bypasses RLS; the
--     asymmetric write-open policies are unchanged except that clients
--     are explicitly denied read access to tracking data).
--   - All new isolation is additive: a client sees a row only when its
--     project is in public.auth_client_project_ids().
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) JWT claim helpers (read from app_metadata, same pattern as auth_org)
-- ---------------------------------------------------------------------
create or replace function public.auth_role() returns text
  language sql stable
  as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'role','') $$;

create or replace function public.auth_user_type() returns text
  language sql stable
  as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'user_type','') $$;

create or replace function public.auth_app_user_id() returns uuid
  language sql stable
  as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid $$;

create or replace function public.auth_is_client() returns boolean
  language sql stable
  as $$ select coalesce(public.auth_user_type() = 'client', false) $$;

-- ---------------------------------------------------------------------
-- 1) clients profile table (mirrors developers/admin_users)
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text,
  email           text not null,
  password        text,                 -- legacy plaintext fallback (parity with existing tables)
  company         text,
  phone           text,
  auth_user_id    uuid,                 -- link to auth.users
  status          text default 'active' check (status in ('active','inactive')),
  created_at      timestamptz default now()
);
create index if not exists idx_clients_org on public.clients(organization_id);
create index if not exists idx_clients_email on public.clients(lower(email));

-- ---------------------------------------------------------------------
-- 2) client <-> project link (a client may have MANY projects)
-- ---------------------------------------------------------------------
create table if not exists public.project_clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  created_at      timestamptz default now(),
  unique (project_id, client_id)
);
create index if not exists idx_project_clients_client on public.project_clients(client_id);
create index if not exists idx_project_clients_project on public.project_clients(project_id);

-- The set of project ids the current client JWT is allowed to see.
create or replace function public.auth_client_project_ids() returns setof uuid
  language sql stable
  as $$ select project_id from public.project_clients where client_id = public.auth_app_user_id() $$;

-- 2b) invitations carry an optional project (used to link a client on accept)
alter table public.invitations add column if not exists project_id uuid
  references public.projects(id) on delete set null;

-- ---------------------------------------------------------------------
-- 3) memberships.user_type: allow 'client'
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  -- Drop ANY existing CHECK constraint on memberships that mentions user_type,
  -- whatever its name, so we can widen the allowed set to include 'client'.
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'memberships'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%user_type%'
  loop
    execute format('alter table public.memberships drop constraint %I', c.conname);
  end loop;
  alter table public.memberships add constraint memberships_user_type_check
    check (user_type in ('admin','developer','client'));
end $$;

-- ---------------------------------------------------------------------
-- 4) client-facing feature tables
-- ---------------------------------------------------------------------
create table if not exists public.milestones (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  description     text,
  due_date        timestamptz,
  status          text default 'pending' check (status in ('pending','in_progress','completed')),
  sort_order      integer default 0,
  created_by      uuid,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_milestones_project on public.milestones(project_id);

create table if not exists public.announcements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade, -- null = org-wide
  title           text not null,
  body            text,
  author_name     text,
  created_by      uuid,
  published_at    timestamptz default now(),
  created_at      timestamptz default now()
);
create index if not exists idx_announcements_project on public.announcements(project_id);

create table if not exists public.project_updates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  body            text,
  created_by      uuid,
  author_name     text,
  created_at      timestamptz default now()
);
create index if not exists idx_project_updates_project on public.project_updates(project_id);

create table if not exists public.approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  item_type       text not null default 'deliverable', -- deliverable | milestone | invoice | general
  item_ref        uuid,                                  -- id of the referenced item (e.g. task_submission)
  title           text not null,
  description     text,
  status          text default 'pending' check (status in ('pending','approved','rejected')),
  decided_by      uuid,                                  -- clients.id who decided
  decided_at      timestamptz,
  note            text,
  created_by      uuid,
  created_at      timestamptz default now()
);
create index if not exists idx_approvals_project on public.approvals(project_id);

create table if not exists public.support_threads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  subject         text not null,
  status          text default 'open' check (status in ('open','closed')),
  last_message_at timestamptz default now(),
  created_at      timestamptz default now()
);
create index if not exists idx_support_threads_project on public.support_threads(project_id);
create index if not exists idx_support_threads_client on public.support_threads(client_id);

create table if not exists public.support_messages (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  thread_id          uuid not null references public.support_threads(id) on delete cascade,
  sender_type        text not null check (sender_type in ('client','agency')),
  sender_id          uuid,
  sender_name        text,
  body               text not null,
  created_at         timestamptz default now()
);
create index if not exists idx_support_messages_thread on public.support_messages(thread_id);

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  number          text not null,
  title           text,
  amount          numeric(12,2) not null default 0,
  currency        text default 'USD',
  status          text default 'draft' check (status in ('draft','sent','paid','overdue','void')),
  issued_at       timestamptz,
  due_at          timestamptz,
  pdf_path        text,                 -- storage path (private bucket)
  notes           text,
  created_by      uuid,
  created_at      timestamptz default now()
);
create index if not exists idx_invoices_project on public.invoices(project_id);
create index if not exists idx_invoices_client on public.invoices(client_id);

-- ---------------------------------------------------------------------
-- 5) org-stamp trigger on all new tables (parity with existing tables)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','project_clients','milestones','announcements','project_updates',
    'approvals','support_threads','support_messages','invoices'
  ] loop
    execute format('drop trigger if exists trg_stamp_org on public.%I', t);
    execute format('create trigger trg_stamp_org before insert on public.%I for each row execute function public.stamp_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6) RLS on the new tables
--    - non-clients (admin/developer/owner): full org access (unchanged model)
--    - clients: SELECT-only, and only rows for their linked projects
--    - client writes go through service_role /api/client/* routes
-- ---------------------------------------------------------------------

-- 6a) clients profile: admins manage; a client can read only their own row
alter table public.clients enable row level security;
drop policy if exists clients_admin on public.clients;
create policy clients_admin on public.clients for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists clients_self_read on public.clients;
create policy clients_self_read on public.clients for select to authenticated
  using (public.auth_is_client() and id = public.auth_app_user_id());

-- 6b) project_clients link: admins manage; client reads own links
alter table public.project_clients enable row level security;
drop policy if exists pc_admin on public.project_clients;
create policy pc_admin on public.project_clients for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists pc_client_read on public.project_clients;
create policy pc_client_read on public.project_clients for select to authenticated
  using (public.auth_is_client() and client_id = public.auth_app_user_id());

-- 6c) project-scoped feature tables: admin full, client read own projects
do $$
declare t text;
begin
  foreach t in array array[
    'milestones','announcements','project_updates','approvals',
    'support_threads','support_messages','invoices'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- non-clients: full org access
    execute format('drop policy if exists %I on public.%I', t||'_admin', t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using (organization_id = public.auth_org() and not public.auth_is_client())
      with check (organization_id = public.auth_org() and not public.auth_is_client())$f$,
      t||'_admin', t);
  end loop;
end $$;

-- client SELECT policies (per-table, because the project link differs)
drop policy if exists milestones_client_read on public.milestones;
create policy milestones_client_read on public.milestones for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and project_id in (select public.auth_client_project_ids()));

drop policy if exists project_updates_client_read on public.project_updates;
create policy project_updates_client_read on public.project_updates for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and project_id in (select public.auth_client_project_ids()));

drop policy if exists approvals_client_read on public.approvals;
create policy approvals_client_read on public.approvals for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and project_id in (select public.auth_client_project_ids()));

-- announcements: project-specific OR org-wide (null project) are visible
drop policy if exists announcements_client_read on public.announcements;
create policy announcements_client_read on public.announcements for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and (project_id is null or project_id in (select public.auth_client_project_ids())));

-- support: a client sees only their own threads/messages
drop policy if exists support_threads_client_read on public.support_threads;
create policy support_threads_client_read on public.support_threads for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and client_id = public.auth_app_user_id());

drop policy if exists support_messages_client_read on public.support_messages;
create policy support_messages_client_read on public.support_messages for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and thread_id in (select id from public.support_threads
                           where client_id = public.auth_app_user_id()));

-- invoices: client sees only invoices linked to them (and non-draft)
drop policy if exists invoices_client_read on public.invoices;
create policy invoices_client_read on public.invoices for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and client_id = public.auth_app_user_id()
         and status <> 'draft');

-- ---------------------------------------------------------------------
-- 7) Tighten EXISTING policies so clients are scoped / denied
--    (admins & developers keep identical access: `not auth_is_client()`
--     is always true for them, so their policy is unchanged in practice.)
-- ---------------------------------------------------------------------

-- 7a) projects: non-clients full org; clients only their linked projects
drop policy if exists org_isolation on public.projects;
create policy org_isolation on public.projects for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists projects_client_read on public.projects;
create policy projects_client_read on public.projects for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and id in (select public.auth_client_project_ids()));

-- 7b) developer_tasks: clients read tasks of their linked projects (read-only)
drop policy if exists org_isolation on public.developer_tasks;
create policy org_isolation on public.developer_tasks for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists developer_tasks_client_read on public.developer_tasks;
create policy developer_tasks_client_read on public.developer_tasks for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and project_id in (select public.auth_client_project_ids()));

-- 7c) task_submissions: clients read deliverables of their linked projects
drop policy if exists org_isolation on public.task_submissions;
create policy org_isolation on public.task_submissions for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists task_submissions_client_read on public.task_submissions;
create policy task_submissions_client_read on public.task_submissions for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and project_id in (select public.auth_client_project_ids()));

-- 7d) memberships: client may read only their own membership row
drop policy if exists org_isolation on public.memberships;
create policy org_isolation on public.memberships for all to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client())
  with check (organization_id = public.auth_org() and not public.auth_is_client());
drop policy if exists memberships_client_self on public.memberships;
create policy memberships_client_self on public.memberships for select to authenticated
  using (public.auth_is_client() and organization_id = public.auth_org()
         and user_id = public.auth_app_user_id());

-- 7e) Deny clients on internal-only website tables (full org access for others).
--     developers, admin_users, productivity_metrics, notifications, teams,
--     departments, invitations.
do $$
declare t text;
begin
  foreach t in array array[
    'developers','admin_users','productivity_metrics','notifications',
    'teams','departments','invitations'
  ] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format($f$create policy org_isolation on public.%I for all to authenticated
      using (organization_id = public.auth_org() and not public.auth_is_client())
      with check (organization_id = public.auth_org() and not public.auth_is_client())$f$, t);
  end loop;
end $$;

-- 7f) Deny clients on ALL desktop-tracking tables (screenshots, keystrokes, …).
do $$
declare t text;
begin
  foreach t in array array[
    'productivity_sessions','keyboard_stats','mouse_activities','app_usage',
    'screenshots','developer_logins','browser_usage','developer_activities'
  ] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('drop policy if exists track_read on public.%I', t);
    execute format($f$create policy track_read on public.%I for select to authenticated
      using (organization_id = public.auth_org() and not public.auth_is_client())$f$, t);
  end loop;
end $$;

commit;

-- =====================================================================
-- NOTE (data step, not SQL): client auth users are created via
-- auth.admin.createUser in /api/invitations/accept with app_metadata =
-- { organization_id, role:'client', user_type:'client', app_user_id: clients.id }.
-- =====================================================================
