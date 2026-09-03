-- ============================================================================
--  077 - Timesheet submission, approval, and billable hours
--
--  WHAT WAS MISSING
--
--  `task_time_logs` has been described as "billable time" since 017 -- the
--  comment appears in 017, 018 and 046 -- and there has never been a column
--  saying which hours are billable. Every logged hour was implicitly billable
--  and nobody could say otherwise, so the word meant nothing.
--
--  The larger gap: time was logged and never AGREED. A developer typed hours
--  into a week and that was the end of it. There was no submission, no review,
--  no point at which a week became a fact somebody had signed off, and so
--  nothing downstream -- payroll, an invoice, a project's real cost -- could
--  rest on it.
--
--  WHY THE LOCK IS A TRIGGER AND NOT AN API CHECK
--
--  This is the important part of this migration. `task_time_logs` is written
--  by the BROWSER, directly through PostgREST -- see `addManualTimeLog` and
--  `stopTimer` in src/utils/pmData.js, which call
--  `supabase.from("task_time_logs").insert(...)` with the caller's own anon-key
--  client. There is no API route in front of it to put a check in.
--
--  So an approval that lived in application code would be advisory: the same
--  browser that renders the approved week can PATCH a row inside it and the
--  screen would never know. The lock has to be in the database or it is not a
--  lock. `timesheet_week_locked()` below runs on every insert, update and
--  delete of a time log, whichever path it arrives by.
--
--  REOPENING IS THE ESCAPE HATCH, and it is deliberate. A locked week is not
--  frozen forever -- an approver moves it back to 'draft' and the hours become
--  editable again. That keeps corrections possible while making them visible:
--  somebody with `timesheet.approve` has to act, and the reopen is recorded.
--
--  NOTHING IS INVENTED. There are no rates here. "Which hours are billable" is
--  a fact the team knows; "what an hour is worth" is a commercial decision that
--  belongs with invoicing, and writing a number in now would put a figure on
--  every project that nobody chose. is_billable DEFAULTS TO TRUE so existing
--  rows keep exactly the meaning the old comments claimed for them, rather than
--  being silently reclassified as non-billable by a migration.
--
--  RUN AFTER 076.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - the billable flag
-- ---------------------------------------------------------------------
--  Default true, and see the header for why: 017 already called this table
--  billable time. A default of false would rewrite the meaning of every row
--  ever logged, which is a bigger claim than this migration is entitled to
--  make.

alter table public.task_time_logs
  add column if not exists is_billable boolean not null default true;

create index if not exists idx_time_logs_billable
  on public.task_time_logs(organization_id, is_billable);

--  Which week a log belongs to, by ISO Monday, in one place.
--  Every read of "the week containing this log" must agree, and three call
--  sites computing it themselves is how they stop agreeing.
create or replace function public.timesheet_week_of(ts timestamptz)
returns date
language sql
immutable
as $$
  select (date_trunc('week', ts at time zone 'UTC'))::date;
$$;


-- ---------------------------------------------------------------------
--  PART 2 - timesheets: one row per person per week
-- ---------------------------------------------------------------------
--  A week with NO ROW is 'draft'. That is why nothing is backfilled: every
--  week ever logged is already in the right state, and inventing thousands of
--  rows to say "not submitted" would be noise that also has to be kept correct.

create table if not exists public.timesheets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  user_id          uuid not null,
  user_type        text not null default 'developer'
                     check (user_type in ('admin','developer')),

  -- ISO Monday. The CHECK is what stops two rows for one week arriving under
  -- different day-of-week conventions and both looking correct.
  week_start       date not null check (extract(isodow from week_start) = 1),

  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','rejected')),

  -- Snapshotted AT SUBMISSION, not derived on read. The totals a person
  -- submitted and the totals an approver agreed have to stay what they were
  -- even if a log is later corrected under a reopened week; a view computed
  -- live would quietly rewrite history.
  total_seconds     bigint not null default 0 check (total_seconds >= 0),
  billable_seconds  bigint not null default 0 check (billable_seconds >= 0),
  constraint timesheet_billable_within_total check (billable_seconds <= total_seconds),

  submitted_at     timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint timesheets_one_per_week unique (organization_id, user_id, week_start)
);

create index if not exists timesheets_org_status_idx on public.timesheets(organization_id, status);
create index if not exists timesheets_user_week_idx  on public.timesheets(user_id, week_start);


-- ---------------------------------------------------------------------
--  PART 3 - the lock
-- ---------------------------------------------------------------------
--  Runs on every insert, update and delete of a time log. See the header: the
--  browser writes this table directly, so this trigger is the only place the
--  rule can actually hold.
--
--  'submitted' locks as well as 'approved'. A week under review that its author
--  can still edit is not under review -- the approver would be agreeing to
--  numbers that changed while they read them.
--
--  DELETE is covered too, and that is not incidental: without it the way to
--  edit an approved week is to delete the row and insert a new one.

create or replace function public.timesheet_week_locked()
returns trigger
language plpgsql
as $$
declare
  v_row     public.task_time_logs;
  v_status  text;
begin
  v_row := coalesce(new, old);

  select t.status into v_status
    from public.timesheets t
   where t.organization_id = v_row.organization_id
     and t.user_id         = v_row.developer_id
     and t.week_start      = public.timesheet_week_of(v_row.started_at)
   limit 1;

  if v_status in ('submitted','approved') then
    raise exception
      'That week has been % and is locked. An approver must reopen it before the hours can change.',
      v_status
      using errcode = 'check_violation';
  end if;

  return v_row;
end;
$$;

drop trigger if exists trg_time_log_week_lock on public.task_time_logs;
create trigger trg_time_log_week_lock
  before insert or update or delete
  on public.task_time_logs
  for each row execute function public.timesheet_week_locked();


-- ---------------------------------------------------------------------
--  PART 4 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS MIRROR THE CATALOGUE and cannot import it:
--
--    timesheet.view_all / timesheet.approve   owner, admin, manager, team_lead
--
--  tests/timesheetApproval.test.js checks these against
--  permissionCatalogue.js by reading this file.
--
--  `finance` is deliberately NOT here. Billable hours are an input to invoicing
--  and finance will need them -- but that is the invoicing feature's decision to
--  make, with an invoice in front of it, not a widening smuggled in early. The
--  catalogue keeps finance off the monitoring surface for the same reason.

alter table public.timesheets enable row level security;

drop policy if exists timesheets_read on public.timesheets;
create policy timesheets_read on public.timesheets
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      user_id = public.auth_app_user_id()
      or coalesce(public.auth_role() in ('owner','admin','manager','team_lead'), false)
    )
  );

--  A person submits their OWN week and may not decide it.
--
--  The status clause is what makes that true against a direct PostgREST write:
--  without it the browser could set 'approved' on its own row and skip every
--  check the route makes. Same arrangement as leave_requests_write_own in 075.
drop policy if exists timesheets_write_own on public.timesheets;
create policy timesheets_write_own on public.timesheets
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and user_id = public.auth_app_user_id())
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and user_id = public.auth_app_user_id()
               and status in ('draft','submitted')
               and public.auth_org_unlocked());

drop policy if exists timesheets_decide on public.timesheets;
create policy timesheets_decide on public.timesheets
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead'), false)
               and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 5 - verify (read-only)
-- ---------------------------------------------------------------------
--  5a) the column and the table exist, and RLS is on
select 'is_billable' as item,
       count(*)::text as present
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'task_time_logs'
   and column_name  = 'is_billable'
union all
select 'timesheets rls',
       coalesce((select c.relrowsecurity::text
                   from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'timesheets'), 'missing');

--  5b) the lock trigger is attached
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.task_time_logs'::regclass
   and not tgisinternal;

--  5c) nothing is locked yet -- expect zero rows, because no week has been
--      submitted. A non-zero answer here right after running 077 would mean
--      the table was not empty, which it should be.
select status, count(*) as weeks
  from public.timesheets
 group by status
 order by status;
