-- =====================================================================
--  033 - Client collaboration on tasks
-- =====================================================================
--  Additive. Nothing is dropped except policies that are immediately recreated
--  with the same staff behaviour plus a client branch.
--
--  WHAT THIS COMPLETES
--   032 gave the client a task LIST and a project-level conversation. Two gaps
--   remained, and the second is the one that matters:
--
--   1. A client could see a task existed but not open it, so there was nowhere
--      to discuss the specific piece of work under review.
--   2. A client's approval decision lived only in the portal. The team never
--      saw it on their own board, so the loop the approval workflow exists to
--      close was still open at the internal end.
--
--  `task_comments` ALREADY EXISTS (016) with the right shape - author, body,
--  mentions, timestamps. It is not rebuilt; it gains an `internal` flag and a
--  client branch on its policies, so one thread carries both audiences rather
--  than a second system nobody keeps in sync.
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
--  PART 1 - Columns
-- ---------------------------------------------------------------------
--  internal              a staff-only comment on a task the client can see.
--                        Defaults FALSE so existing comments keep their current
--                        meaning, and PART 2 then makes every one of them
--                        internal - see the reasoning there.
--  client_approval_status  what the client has said about this task, surfaced
--                        on the internal board. Deliberately separate from
--                        `status`: the review pipeline is the team's, and
--                        overloading it would let a client decision move a task
--                        through a workflow that migration 021 exists to guard.
--  client_approval_note  the reason behind changes_requested, so the team reads
--                        it where they work rather than in the portal.

alter table public.task_comments add column if not exists internal boolean not null default false;
alter table public.developer_tasks add column if not exists client_approval_status text;
alter table public.developer_tasks add column if not exists client_approval_note text;
alter table public.developer_tasks add column if not exists client_approval_at timestamptz;


-- ---------------------------------------------------------------------
--  PART 2 - Every EXISTING task comment becomes internal
-- ---------------------------------------------------------------------
--  This is the opposite of 032's task backfill, on purpose. There, existing
--  tasks were already visible to the client and hiding them would have removed
--  something the client relies on. Here, no comment has ever been visible to a
--  client, and every one was written by staff who had no reason to expect an
--  outside reader. Defaulting them open would publish years of internal
--  discussion in one statement.

update public.task_comments set internal = true where internal = false;


-- ---------------------------------------------------------------------
--  PART 3 - Constraint
-- ---------------------------------------------------------------------

alter table public.developer_tasks drop constraint if exists developer_tasks_client_approval_check;
alter table public.developer_tasks add constraint developer_tasks_client_approval_check check (client_approval_status is null or client_approval_status in ('pending', 'approved', 'changes_requested', 'rejected'));


-- ---------------------------------------------------------------------
--  PART 4 - Indexes
-- ---------------------------------------------------------------------

create index if not exists idx_task_comments_task_created on public.task_comments (task_id, created_at desc);
create index if not exists idx_dev_tasks_client_approval on public.developer_tasks (organization_id, client_approval_status) where client_approval_status is not null;


-- ---------------------------------------------------------------------
--  PART 5 - Policies: keep staff exactly as they are, add a client branch
-- ---------------------------------------------------------------------
--  The staff policies are recreated verbatim from 018 - same predicates, same
--  roles - so nothing about internal behaviour changes. What is new is that a
--  client may read and write NON-INTERNAL comments, and only on a task that is
--  itself client-visible, in a project on their allow-list. Three conditions,
--  all in the database: hiding the thread in the UI would leave it readable to
--  anyone with the anon key and a session.

drop policy if exists task_comments_read on public.task_comments;
drop policy if exists task_comments_insert on public.task_comments;
drop policy if exists task_comments_client_read on public.task_comments;
drop policy if exists task_comments_client_insert on public.task_comments;

create policy task_comments_read on public.task_comments for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());
create policy task_comments_insert on public.task_comments for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());

create policy task_comments_client_read on public.task_comments for select to authenticated using (public.auth_is_client() and internal = false and task_id in (select t.id from public.developer_tasks t where t.client_visible = true and t.project_id in (select public.auth_client_project_ids())));
create policy task_comments_client_insert on public.task_comments for insert to authenticated with check (public.auth_is_client() and internal = false and author_type = 'client' and author_id = public.auth_app_user_id() and task_id in (select t.id from public.developer_tasks t where t.client_visible = true and t.project_id in (select public.auth_client_project_ids())));

-- No client UPDATE or DELETE policy. A client may add to the record and may not
-- edit or remove it, which is what makes the thread usable as evidence of what
-- was agreed.


-- ---------------------------------------------------------------------
--  PART 6 - Grants
-- ---------------------------------------------------------------------
--  task_comments predates the client role having any reason to touch it. A
--  missing grant fails before RLS is ever consulted, and looks identical to a
--  policy that refuses - so it is stated rather than assumed.

grant select, insert on public.task_comments to authenticated;


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select count(*) as internal_comments from public.task_comments where internal = true;
-- select count(*) as client_visible_comments from public.task_comments where internal = false;
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'task_comments' order by policyname;
-- select client_approval_status, count(*) from public.developer_tasks group by client_approval_status;
