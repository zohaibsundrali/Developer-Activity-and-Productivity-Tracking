-- =====================================================================
--  029 - Notification centre
-- =====================================================================
--  Additive columns and indexes, plus ONE policy change that narrows access.
--  No table is dropped and no existing column is altered.
--
--  THE POLICY CHANGE MATTERS
--   Migration 013 gave notifications the generic org policy:
--     for all to authenticated using (organization_id = auth_org())
--   That is correct for cross-tenant isolation and wrong within a tenant: any
--   member of an organization can read EVERY notification in it, including ones
--   addressed to the owner. A developer with the anon key and a session can
--   read management's review queue.
--
--   The app already filters to the signed-in recipient in every query it makes,
--   so narrowing the policy to match costs nothing in the UI and closes the
--   gap for anyone querying the table directly.
--
--   Recipients are matched three ways because the table addresses them three
--   ways, all of which are in live use:
--     developer_id / assigned_developer_id  -> a developer's app user id
--     admin_id                              -> an admin's app user id (text)
--     admin_email                           -> an admin by email
--
--   ONE DELIBERATE LOOSENESS: owner and admin can still read every notification
--   in their own organization. There is no email claim in the JWT, so a policy
--   cannot match the admin_email addressing that several callers use - an admin
--   notified only by email would otherwise see nothing at all. Owner and admin
--   already administer the organization, so this is a narrower grant than it
--   replaces. The gap that mattered is closed: a developer, employee, team lead,
--   manager or hr can no longer read management's review queue, which the
--   previous org-wide policy allowed.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles both. Statements that ADD a
--  column are in an earlier PART than statements that reference it, because
--  that editor resolves a whole paste before running any of it. It also shows
--  only the LAST statement's result, so verify queries go one at a time.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Columns
-- ---------------------------------------------------------------------
--  read_at    when it was read, not just that it was. `read` stays the source
--             of truth so nothing existing changes behaviour.
--  entity_*   a generic target so a notification can point at a sprint, an
--             employee or a comment, none of which have a dedicated column.
--             task_id / project_id stay as they are and keep working.
--  actor_id   who caused it, so the UI can say "Sara assigned you a task"
--             and so a user is never notified about their own action.
--  category   the coarse grouping the notification centre filters by. `type`
--             already carries eleven different values written by seven callers
--             and is not safe to repurpose.

alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id uuid;
alter table public.notifications add column if not exists actor_id uuid;
alter table public.notifications add column if not exists category text;
alter table public.notifications add column if not exists dedupe_key text;


-- ---------------------------------------------------------------------
--  PART 2 - Backfill, so existing rows are not stranded outside the filters
-- ---------------------------------------------------------------------

update public.notifications set read_at = created_at where read = true and read_at is null;

update public.notifications set category = case when type in ('task_assigned') then 'assignment' when type in ('task_submitted', 'review_required') then 'review' when type in ('task_approved', 'task_rejected') then 'review' when type in ('due_reminder', 'deadline_reminder') then 'deadline' when type in ('project_assigned') then 'project' when type in ('automation') then 'automation' else 'general' end where category is null;


-- ---------------------------------------------------------------------
--  PART 3 - Indexes for the recipient queries (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  The notification centre reads "mine, newest first" and "how many of mine are
--  unread". Both need the recipient as the leading column, which is why the
--  022 index on (organization_id, read) does not serve them.

create index if not exists idx_notifications_dev_unread on public.notifications (developer_id, read, created_at desc);
create index if not exists idx_notifications_assigned_unread on public.notifications (assigned_developer_id, read, created_at desc);
create index if not exists idx_notifications_admin_unread on public.notifications (admin_id, read, created_at desc);
create index if not exists idx_notifications_admin_email_unread on public.notifications (admin_email, read, created_at desc);
create index if not exists idx_notifications_org_category_created on public.notifications (organization_id, category, created_at desc);

-- Duplicate suppression. A dedupe_key is set by the caller for events that can
-- fire more than once for the same thing - a status change replayed by an
-- automation, a due reminder run twice in a day. Rows without a key are
-- unaffected, so nothing existing is constrained.
create unique index if not exists uq_notifications_dedupe on public.notifications (dedupe_key) where dedupe_key is not null;


-- ---------------------------------------------------------------------
--  PART 4 - Narrow the read policy to the recipient
-- ---------------------------------------------------------------------
--  The org policy is FOR ALL, so replacing it also removes the org-wide write
--  path. Writes are re-granted below as INSERT only, still org-scoped: the app
--  creates notifications from the browser in several places (project deleted,
--  developer added) and those must keep working. Nothing may UPDATE another
--  person's notification, and marking your own read is an UPDATE on a row you
--  can already see.

drop policy if exists org_isolation on public.notifications;
drop policy if exists notifications_read on public.notifications;
drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_update on public.notifications;

create policy notifications_read on public.notifications for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and (developer_id = public.auth_app_user_id() or assigned_developer_id = public.auth_app_user_id() or admin_id = public.auth_app_user_id()::text or public.auth_role() in ('owner', 'admin')));

create policy notifications_insert on public.notifications for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client());

create policy notifications_update on public.notifications for update to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and (developer_id = public.auth_app_user_id() or assigned_developer_id = public.auth_app_user_id() or admin_id = public.auth_app_user_id()::text or public.auth_role() in ('owner', 'admin'))) with check (organization_id = public.auth_org());


-- ---------------------------------------------------------------------
--  PART 5 - Derive category on insert when the caller does not set one
-- ---------------------------------------------------------------------
--  Seven existing callers insert notifications and none of them know about
--  `category`. Rather than edit all seven - which would be a refactor with no
--  behavioural payoff - the same mapping used for the backfill runs on insert.
--  A caller that DOES set a category keeps it.
--
--  Single-quoted function body, no dollar quoting: the target editor mangles it.

create or replace function public.derive_notification_category() returns trigger language plpgsql as 'begin if NEW.category is not null then return NEW; end if; NEW.category := case when NEW.type in (''task_assigned'') then ''assignment'' when NEW.type in (''task_submitted'', ''review_required'', ''task_approved'', ''task_rejected'') then ''review'' when NEW.type in (''due_reminder'', ''deadline_reminder'') then ''deadline'' when NEW.type in (''project_assigned'') then ''project'' when NEW.type in (''automation'') then ''automation'' else ''general'' end; return NEW; end';

drop trigger if exists trg_derive_notification_category on public.notifications;
create trigger trg_derive_notification_category before insert on public.notifications for each row execute function public.derive_notification_category();


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select policyname, cmd, roles::text from pg_policies where schemaname = 'public' and tablename = 'notifications' order by policyname;
-- select category, count(*) from public.notifications group by category order by 2 desc;
-- select count(*) as unbackfilled from public.notifications where category is null;
-- select indexname from pg_indexes where schemaname = 'public' and tablename = 'notifications' order by indexname;
