-- =====================================================================
--  034 - Notification metadata, dismissal, and per-user preferences
-- =====================================================================
--  Additive. No column is renamed and no policy is loosened.
--
--  WHY NOTHING IS RENAMED
--   The columns are addressed four ways for historical reasons
--   (developer_id / assigned_developer_id / admin_id / admin_email) and seven
--   writers depend on them, as do two migrations of RLS policy, the hook and
--   the panel. Renaming them to a cleaner scheme is a worthwhile change and a
--   BAD one to make in the same step as adding features: a rename that breaks
--   an insert fails silently inside a try/catch, and the symptom is a
--   notification that never arrives. If the scheme is to change it should be
--   its own migration with nothing else riding on it.
--
--  WHERE PREFERENCES ARE ENFORCED
--   In the database, not in notify(). notify() is the client-side path; cron,
--   the review route, the submission route and four components insert directly.
--   A check that lives in one of those is a check six writers walk past. A
--   BEFORE INSERT trigger that returns NULL drops the row for every writer
--   there is, including ones not written yet, and needs no code change.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. A column is created in an earlier PART than anything referencing it,
--  because that editor resolves a whole paste before running any of it. It also
--  shows only the LAST statement's result, so verify queries go one at a time.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Columns
-- ---------------------------------------------------------------------
--  metadata      structured context a notification card can render without a
--                second query - a task title, an old and new status, a count.
--  dismissed_at  a soft dismissal. Deleting the row would take the record of
--                what was sent with it, and "I never got that" is exactly the
--                question a notification log exists to answer.

alter table public.notifications add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists dismissed_at timestamptz;


-- ---------------------------------------------------------------------
--  PART 2 - Preferences
-- ---------------------------------------------------------------------
--  One row per (user, category) and ONLY for categories a user has switched
--  off. An absent row means enabled, so the default costs no storage and a new
--  category is on for everyone without a backfill.

create table if not exists public.notification_preferences (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null, user_type text not null default 'developer', category text not null, enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create unique index if not exists uq_notification_prefs_user_category on public.notification_preferences (user_id, category);
create index if not exists idx_notification_prefs_org on public.notification_preferences (organization_id);


-- ---------------------------------------------------------------------
--  PART 3 - Indexes for the new columns (AFTER part 1)
-- ---------------------------------------------------------------------
--  The panel and the history page both read "mine, not dismissed, newest
--  first". Partial indexes keep dismissed rows out of the hot path entirely.

create index if not exists idx_notifications_dev_active on public.notifications (developer_id, created_at desc) where dismissed_at is null;
create index if not exists idx_notifications_admin_active on public.notifications (admin_id, created_at desc) where dismissed_at is null;
create index if not exists idx_notifications_entity on public.notifications (entity_type, entity_id) where entity_type is not null;


-- ---------------------------------------------------------------------
--  PART 4 - RLS on preferences
-- ---------------------------------------------------------------------
--  A user manages only their own. There is no admin override: muting someone
--  else's notifications is not an administrative act, it is a way to keep them
--  from finding out about something.

alter table public.notification_preferences enable row level security;

drop policy if exists notification_prefs_own on public.notification_preferences;
create policy notification_prefs_own on public.notification_preferences for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and user_id = public.auth_app_user_id()) with check (organization_id = public.auth_org() and not public.auth_is_client() and user_id = public.auth_app_user_id());

grant select, insert, update, delete on public.notification_preferences to authenticated;


-- ---------------------------------------------------------------------
--  PART 5 - Drop muted notifications at the door
-- ---------------------------------------------------------------------
--  Returning NULL from a BEFORE INSERT trigger skips the row silently, which is
--  what a muted category should do: the sender is not told, because whether a
--  recipient wants to hear about comments is not the sender's business.
--
--  The recipient is resolved the way the read policy matches it: developer_id,
--  assigned_developer_id, then admin_id. `actor_id` is NOT a fallback, and that
--  is the whole point - it names who CAUSED the notification, not who receives
--  it. Falling through to it would apply the sender's mute settings to the
--  recipient's row, so one person silencing a category for themselves would
--  silence it for everyone they notify. A client could do it to every member of
--  staff, which is why the preferences policy also excludes clients: they have
--  no notification centre to configure, since 029 excludes them from reading
--  the table at all.
--
--  A row with no category, or no resolvable recipient, is always delivered.
--  Failing open is right here: the cost of a wrong mute is silence, and the
--  cost of a wrong send is one extra line in a list.

create or replace function public.apply_notification_preference() returns trigger language plpgsql security definer set search_path = public as 'declare muted boolean; recipient uuid; begin if NEW.category is null then return NEW; end if; recipient := coalesce(NEW.developer_id, NEW.assigned_developer_id); if recipient is null and NEW.admin_id is not null then begin recipient := NEW.admin_id::uuid; exception when others then recipient := null; end; end if; if recipient is null then return NEW; end if; select not p.enabled into muted from public.notification_preferences p where p.user_id = recipient and p.category = NEW.category limit 1; if muted then return null; end if; return NEW; end';

drop trigger if exists trg_apply_notification_preference on public.notifications;
create trigger trg_apply_notification_preference before insert on public.notifications for each row execute function public.apply_notification_preference();


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select count(*) as muted_categories from public.notification_preferences where enabled = false;
-- select count(*) as dismissed from public.notifications where dismissed_at is not null;
-- select tgname from pg_trigger where tgrelid = 'public.notifications'::regclass and not tgisinternal order by tgname;
-- select indexname from pg_indexes where schemaname = 'public' and tablename = 'notifications' order by indexname;
