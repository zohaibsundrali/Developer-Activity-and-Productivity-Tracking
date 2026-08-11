-- =====================================================================
--  063 - closing a project, and the client's word on it
-- =====================================================================
--
--  WHAT THIS DELIBERATELY DOES NOT DO: CONSTRAIN projects.status
--
--  It is tempting, because `projects.status` has NO constraint at all — any
--  string is accepted, verified by inserting `'zzz_not_a_status'` into the live
--  table, which succeeded. That is a real gap.
--
--  But it is not this migration's gap to close, because there is no agreed
--  vocabulary to close it to. Two PROJECT_STATUS maps exist in the app and they
--  DISAGREE WITH EACH OTHER:
--
--    src/components/developer/MyProjects.jsx
--        active, in_progress, completed, done, pending, assigned
--    src/components/developer/DashboardOverview.jsx
--        completed, in_progress, "in progress", active, on_hold, "on hold",
--        cancelled, canceled
--
--  Eleven spellings for perhaps five states, with "done"/"assigned" known to
--  one map and "on_hold"/"cancelled" to the other. Picking a set here would
--  lock out whichever spellings the other writers use, and the failure would
--  land on somebody saving a project weeks later. Normalising that needs its
--  own pass: survey every writer, migrate the existing rows, THEN constrain.
--
--  SO CLOSURE DOES NOT DEPEND ON THAT STRING.
--
--  The columns below are timestamps and they are the truth. "Is this project
--  closed?" is `closed_at is not null` — a question with one answer, whatever
--  the status text happens to say. The route still writes a friendly status
--  alongside so the existing badges keep working, but nothing reads it to
--  decide anything.
--
--  RUN PART 1, then PART 2, then PART 3 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The columns
-- ---------------------------------------------------------------------

alter table public.projects
  --  The project manager's word: the work is done.
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,

  --  The client's word. Separate from the PM's on purpose — "we think it is
  --  finished" and "the customer agrees it is finished" are different facts,
  --  and the gap between them is where a project quietly sits for a month.
  add column if not exists client_signed_off_at timestamptz,

  --  1-5. Constrained because the only thing a rating is for is comparing
  --  across projects, and a scale nobody agrees on cannot be compared.
  add column if not exists client_rating smallint
    check (client_rating is null or client_rating between 1 and 5),
  add column if not exists client_feedback text,

  --  The administrator's word: the file is shut. This is the one that means
  --  closed; the other two are steps towards it.
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid,
  add column if not exists closure_note text;

--  "What is still open?" is the question every dashboard asks first.
create index if not exists idx_projects_org_open
  on public.projects (organization_id)
  where closed_at is null;


-- ---------------------------------------------------------------------
--  PART 2 - The order these may happen in
-- ---------------------------------------------------------------------

create or replace function public.tg_project_closure_guard() returns trigger
  language plpgsql
as $fn$
begin
  --  A project cannot be closed before the work is finished. Without this,
  --  "closed" becomes a way to make an inconvenient project disappear from a
  --  report, and the hours already logged against it stop adding up anywhere.
  if new.closed_at is not null and new.completed_at is null then
    raise exception 'Mark the work complete before closing the project.'
      using errcode = 'check_violation';
  end if;

  --  A rating or a comment is the CLIENT'S, so it cannot exist before the
  --  client has said anything. Otherwise a five-star score can be typed in by
  --  the company that earned it.
  if (new.client_rating is not null or coalesce(btrim(new.client_feedback), '') <> '')
     and new.client_signed_off_at is null then
    raise exception 'A rating or feedback only exists once the client has signed off.'
      using errcode = 'check_violation';
  end if;

  --  Reopening is deliberate, and it clears the sign-off with it: a client who
  --  approved version one has not approved whatever comes next.
  if tg_op = 'UPDATE' and old.closed_at is not null and new.closed_at is null then
    new.client_signed_off_at := null;
    new.completed_at := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_project_closure_guard on public.projects;
create trigger trg_project_closure_guard
  before insert or update on public.projects
  for each row execute function public.tg_project_closure_guard();


-- ---------------------------------------------------------------------
--  PART 3 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  3a. Expect eight rows, all nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('completed_at','completed_by','client_signed_off_at',
                      'client_rating','client_feedback','closed_at','closed_by','closure_note')
order by column_name;

--  3b. The rating scale is enforced.
select pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.projects'::regclass
  and pg_get_constraintdef(oid) ilike '%client_rating%';

--  3c. The guard is attached.
select tgname from pg_trigger
where tgrelid = 'public.projects'::regclass and not tgisinternal
order by tgname;

--  3d. Nothing existing moved: every project is still open, because closure is
--      a thing that has not happened yet. Expect closed = 0.
select count(*) filter (where closed_at is not null) as closed,
       count(*) as total
from public.projects;

--  3e. projects.status is STILL unconstrained, and that is on purpose — see
--      the header. Expect 0 rows; when somebody normalises the vocabulary this
--      is the query that should start returning one.
--
--      MATCHED ON THE COLUMN, NOT ON THE TEXT. This query first read
--      `pg_get_constraintdef(oid) ilike '%status%'`, which also matches
--      `projects_task_plan_status_check` — a constraint on a DIFFERENT column,
--      task_plan_status. Run against the live database it returned that row,
--      which reads as "status is constrained" when it is not. Joining through
--      conkey asks the question that was meant: is there a check constraint
--      covering the `status` column itself?
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join unnest(con.conkey) as k(attnum) on true
join pg_attribute a
  on a.attrelid = con.conrelid and a.attnum = k.attnum
where con.conrelid = 'public.projects'::regclass
  and con.contype = 'c'
  and a.attname = 'status';
