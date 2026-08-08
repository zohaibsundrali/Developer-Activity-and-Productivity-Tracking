-- =====================================================================
--  032 - Client Portal 2.0
-- =====================================================================
--  Additive. No existing table, column or policy is dropped, and one CHECK is
--  WIDENED (approvals.status gains 'changes_requested'), which only ever admits
--  a value that was previously rejected.
--
--  THE DEFECT THIS FIXES
--   /api/client/projects/[id] returns EVERY task on the project. There is no
--   client-visibility concept anywhere in the schema, so an internal task title
--   - "chase the client about the overdue invoice", "rework Ahmed's estimate" -
--   is read by the client verbatim. The portal has been exposing the team's
--   internal board since it shipped.
--
--   `client_visible` closes it. The column DEFAULTS TO FALSE so new internal
--   work is private the moment it is created, and PART 2 backfills every
--   EXISTING row to true so nothing the client can see today disappears. That
--   asymmetry is deliberate: the safe default applies going forward, and
--   nothing regresses for work already in flight.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. Statements that ADD a column live in an earlier PART than statements
--  that reference it, because that editor resolves a whole paste before running
--  any of it. It also shows only the LAST statement's result, so verify queries
--  must be run one at a time.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Visibility columns
-- ---------------------------------------------------------------------

alter table public.developer_tasks add column if not exists client_visible boolean not null default false;
alter table public.milestones add column if not exists client_visible boolean not null default true;
alter table public.project_updates add column if not exists client_visible boolean not null default true;

-- Milestones and project updates default to TRUE: both exist to be told to the
-- client. A task defaults to false because most tasks are internal.


-- ---------------------------------------------------------------------
--  PART 2 - Backfill, so today's portal does not go blank
-- ---------------------------------------------------------------------
--  Every task that exists right now is already visible to the client, because
--  the route never filtered. Making them true preserves exactly what the client
--  sees today; only work created from now on starts private.

update public.developer_tasks set client_visible = true where client_visible = false;


-- ---------------------------------------------------------------------
--  PART 3 - Project-level comments
-- ---------------------------------------------------------------------
--  Support threads are ORG-level and already exist. This is the project-scoped
--  conversation the portal has never had. `internal` lets staff talk on the
--  same thread without the client seeing it - the alternative is a second
--  system nobody keeps in sync.

create table if not exists public.project_comments (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, project_id uuid not null references public.projects(id) on delete cascade, author_id uuid, author_type text not null default 'staff', author_name text, body text not null, attachment_path text, attachment_name text, attachment_type text, attachment_size integer, internal boolean not null default false, created_at timestamptz not null default now());

create index if not exists idx_project_comments_project_created on public.project_comments (project_id, created_at desc);
create index if not exists idx_project_comments_org_created on public.project_comments (organization_id, created_at desc);


-- ---------------------------------------------------------------------
--  PART 4 - Approval audit trail
-- ---------------------------------------------------------------------
--  `approvals` keeps only the LAST decision - decided_by, decided_at, note are
--  overwritten each time. A client who requests changes twice and then approves
--  leaves no record of the first two rounds, which is exactly the history an
--  approval workflow exists to produce.

create table if not exists public.approval_events (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, approval_id uuid not null references public.approvals(id) on delete cascade, project_id uuid not null references public.projects(id) on delete cascade, actor_id uuid, actor_type text not null default 'client', actor_name text, action text not null, note text, created_at timestamptz not null default now());

create index if not exists idx_approval_events_approval_created on public.approval_events (approval_id, created_at desc);
create index if not exists idx_approval_events_project_created on public.approval_events (project_id, created_at desc);

alter table public.approval_events drop constraint if exists approval_events_action_check;
alter table public.approval_events add constraint approval_events_action_check check (action in ('approved', 'rejected', 'changes_requested', 'commented', 'reopened'));


-- ---------------------------------------------------------------------
--  PART 5 - Widen approvals.status for "request changes"
-- ---------------------------------------------------------------------
--  Rejecting and asking for a revision are different outcomes: one ends the
--  item, the other returns it. Collapsing them loses the distinction the client
--  is actually making. Widening only ADDS a permitted value.

alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'changes_requested'));


-- ---------------------------------------------------------------------
--  PART 6 - Row level security (AFTER the tables exist)
-- ---------------------------------------------------------------------
--  Staff: their own organization, as everywhere else.
--  Client: only projects on their allow-list, only non-internal rows, and for
--  comments only their own author identity on write. A client can never mark a
--  comment internal, and can never see one.

alter table public.project_comments enable row level security;
alter table public.approval_events enable row level security;

drop policy if exists project_comments_staff on public.project_comments;
drop policy if exists project_comments_client_read on public.project_comments;
drop policy if exists project_comments_client_write on public.project_comments;
drop policy if exists approval_events_staff on public.approval_events;
drop policy if exists approval_events_client_read on public.approval_events;

create policy project_comments_staff on public.project_comments for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client()) with check (organization_id = public.auth_org() and not public.auth_is_client());
create policy project_comments_client_read on public.project_comments for select to authenticated using (public.auth_is_client() and internal = false and project_id in (select public.auth_client_project_ids()));
create policy project_comments_client_write on public.project_comments for insert to authenticated with check (public.auth_is_client() and internal = false and author_type = 'client' and author_id = public.auth_app_user_id() and project_id in (select public.auth_client_project_ids()));

create policy approval_events_staff on public.approval_events for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client()) with check (organization_id = public.auth_org() and not public.auth_is_client());
create policy approval_events_client_read on public.approval_events for select to authenticated using (public.auth_is_client() and project_id in (select public.auth_client_project_ids()));

-- No client INSERT policy on approval_events: the decision route writes the
-- audit row with the service role after it has verified the decision. A client
-- that could write its own audit trail is not an audit trail.


-- ---------------------------------------------------------------------
--  PART 7 - Stamp the organization on insert
-- ---------------------------------------------------------------------

--  Explicit grants. Supabase configures default privileges so a table created
--  in public is usually reachable by the authenticated role already, but a
--  migration that depends on that being true fails silently and completely if
--  it is not - RLS never even gets consulted, the role simply cannot see the
--  table. Granting here costs nothing and removes the assumption.
grant select, insert, update, delete on public.project_comments to authenticated;
grant select, insert, update, delete on public.approval_events to authenticated;


drop trigger if exists trg_stamp_org on public.project_comments;
create trigger trg_stamp_org before insert on public.project_comments for each row execute function public.stamp_org();

drop trigger if exists trg_stamp_org on public.approval_events;
create trigger trg_stamp_org before insert on public.approval_events for each row execute function public.stamp_org();


-- ---------------------------------------------------------------------
--  PART 8 - Let a client attach a file to a comment, and nothing else
-- ---------------------------------------------------------------------
--  Migration 020's org_files_insert carries `not auth_is_client()`, so a client
--  cannot write to the private bucket at all. Comment attachments therefore
--  fail at the upload step while the comment itself succeeds.
--
--  This adds the narrowest policy that closes it. A client may write only to
--  {their org}/client-comments/{a project they are allow-listed on}/..., which
--  keeps every other folder - employee photos, project documents, monitoring
--  screenshots - as unreachable as it is today. There is deliberately no
--  update or delete policy: an attachment on someone else's comment thread is
--  not a client's to replace or remove.
--
--  Reads already work: org_files_read grants select to any authenticated member
--  of the owning organization, and a client is a member.

drop policy if exists org_files_client_comment_insert on storage.objects;
create policy org_files_client_comment_insert on storage.objects for insert to authenticated with check (bucket_id = 'org-files' and public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text and (storage.foldername(name))[2] = 'client-comments' and ((storage.foldername(name))[3])::uuid in (select public.auth_client_project_ids()));


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select count(*) as tasks_visible_to_client from public.developer_tasks where client_visible = true;
-- select count(*) as tasks_private from public.developer_tasks where client_visible = false;
-- select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('project_comments','approval_events') order by tablename, policyname;
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.approvals'::regclass and contype = 'c';
