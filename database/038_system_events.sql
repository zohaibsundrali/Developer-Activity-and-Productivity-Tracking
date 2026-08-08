-- =====================================================================
--  038 - system_events: the server-side event log behind Admin - System Health
-- =====================================================================
--  Additive only. No existing table, column, policy, index or trigger is
--  altered or dropped. Nothing in the app changes behaviour because this table
--  exists; it is written best-effort from server code and read by exactly one
--  route (GET /api/admin/health).
--
--  WHAT THIS IS FOR
--   src/utils/logger.js already reports errors that happen in a BROWSER. It
--   cannot see a cron job that failed at 03:00, a Stripe webhook that threw, or
--   a rejected token - none of those have a browser attached. This table is the
--   server-side half: a durable, queryable record of the failures the product
--   only finds out about today by someone noticing the work did not happen.
--
--  WHO WRITES IT
--   Only the service role, from src/utils/systemEvents.js. There is deliberately
--   no INSERT / UPDATE / DELETE policy below, so a browser holding the anon key
--   and a valid session cannot append to the log, cannot rewrite history and
--   cannot delete the evidence of an incident. An audit log a tenant can edit is
--   not an audit log.
--
--  WHO READS IT
--   owner and admin, their own organization, SELECT only. Not developers, not
--   managers, not HR, and never a client: these rows name internal jobs and
--   carry failure detail from other tenants' worth of infrastructure.
--
--  ROWS WITH A NULL organization_id
--   Some failures are platform-wide and belong to no tenant - a cron run that
--   died before it could resolve an organization, a webhook whose customer could
--   not be mapped, a rejected token that carried no org claim. Those are stored
--   with organization_id NULL, and the read policy below requires
--   `organization_id is not null` FIRST, deliberately and explicitly: a NULL
--   organization_id is NOT equal to any org id in SQL, but relying on that
--   silently is how a future policy edit turns platform rows into everyone's
--   rows. So, stated plainly: rows with a null organization_id are visible to
--   NOBODY through RLS. They are reachable only by the service role, and are
--   there for a future platform console that runs on it.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. It also resolves an entire paste before running it, so statements
--  that CREATE a table are kept in an earlier PART than statements that
--  reference its columns, and it shows only the LAST statement's result, so the
--  verify queries at the bottom must be run one at a time.
--
--  Run each PART as its own query. Every statement is idempotent - the whole
--  file can be re-run safely.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The table
-- ---------------------------------------------------------------------
--  organization_id is NULLABLE and ON DELETE SET NULL rather than CASCADE:
--  deleting a tenant must not erase the record that its integration was
--  failing. The row survives as a platform-scoped event, which is exactly the
--  category described above.
--
--  context is jsonb and is sanitised in application code to a small allow-list
--  of scalar keys before it ever reaches here. It must never carry a token, a
--  password, a Stripe payload or a request body - see src/utils/systemEvents.js.

create table if not exists public.system_events (id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete set null, event_type text not null, severity text not null default 'info', source text not null default 'api', message text, context jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());


-- ---------------------------------------------------------------------
--  PART 2 - Constraints (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  severity and source are closed vocabularies. The health route derives a
--  status per source and counts by severity, so an unexpected value would not
--  crash anything - it would quietly fall out of both, which is worse. The
--  constraint makes a typo in a recordEvent() call fail loudly in development
--  instead of producing an event nobody ever sees.
--
--  drop-then-add rather than `add constraint if not exists` (which PostgreSQL
--  does not have) keeps re-running the file safe and lets the vocabulary be
--  widened later by editing one line.

alter table public.system_events drop constraint if exists system_events_severity_check;
alter table public.system_events add constraint system_events_severity_check check (severity in ('info', 'warning', 'error', 'critical'));

alter table public.system_events drop constraint if exists system_events_source_check;
alter table public.system_events add constraint system_events_source_check check (source in ('api', 'cron', 'automation', 'email', 'auth', 'database'));


-- ---------------------------------------------------------------------
--  PART 3 - Indexes (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  Every read this table gets is "newest first, filtered by one of three
--  things", so each index leads with the filter column and carries created_at
--  desc as its second key. That lets the planner satisfy the ORDER BY from the
--  index instead of sorting the whole tenant's history on every dashboard load.
--
--  The org index is the hot one: it serves the default view, the 24h counts and
--  the per-source lookups within a tenant. The other two exist because the
--  admin surface filters by severity and by source directly.

create index if not exists idx_system_events_org_created on public.system_events (organization_id, created_at desc);
create index if not exists idx_system_events_severity_created on public.system_events (severity, created_at desc);
create index if not exists idx_system_events_source_created on public.system_events (source, created_at desc);


-- ---------------------------------------------------------------------
--  PART 4 - Row Level Security (AFTER the table exists)
-- ---------------------------------------------------------------------
--  SELECT only, and only for owner/admin in their own organization.
--
--  Four conditions, each earning its place:
--    organization_id is not null      - platform rows belong to nobody (above)
--    organization_id = auth_org()     - tenant isolation
--    not auth_is_client()             - a client is never staff, belt and braces
--                                       on top of the role list
--    auth_role() in (owner, admin)    - developers, managers, team leads and HR
--                                       have no business reading infrastructure
--                                       failures
--
--  There is no INSERT, UPDATE or DELETE policy, and none should be added. With
--  RLS enabled and no policy for a command, that command is denied to every
--  non-superuser role - the service role bypasses RLS and remains the only
--  writer. This is the same shape migration 027 uses for billing_events.

alter table public.system_events enable row level security;

drop policy if exists system_events_read on public.system_events;
create policy system_events_read on public.system_events for select to authenticated using (organization_id is not null and organization_id = public.auth_org() and not public.auth_is_client() and public.auth_role() in ('owner', 'admin'));


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'system_events' order by ordinal_position;
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.system_events'::regclass order by conname;
-- select indexname from pg_indexes where schemaname = 'public' and tablename = 'system_events' order by indexname;
-- select relrowsecurity from pg_class where oid = 'public.system_events'::regclass;
-- select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'system_events';
