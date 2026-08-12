-- =====================================================================
--  065 - projects.status finally means something
-- =====================================================================
--
--  WHAT WAS WRONG
--
--  `projects.status` has NO constraint. Any string is accepted — verified by
--  inserting 'zzz_still_not_a_status' into the live table, which returned 201.
--  063 deliberately left it that way and said why: there was no agreed
--  vocabulary to constrain it to, because the app's own screens disagreed.
--
--      developer/MyProjects        active, in_progress, completed, done,
--                                  pending, assigned
--      developer/DashboardOverview completed, in_progress, "in progress",
--                                  active, on_hold, "on hold", cancelled,
--                                  canceled
--      developer/Timesheet         pending, in_progress, completed
--      client/ClientShared         anything, humanised
--
--  Eleven spellings for six states. Picking a set blind would have locked out
--  whichever spellings the other writers used, and the failure would have
--  landed weeks later on somebody saving a project.
--
--  SO THE WRITERS WERE SURVEYED FIRST. There are four, and between them they
--  write five values:
--
--      AllProjects (create)          'active'
--      /api/proposals/[id]/decide    'pending'
--      pmData.cloneProject           'pending'
--      /api/projects/[id]/closure    'completed', 'closed', 'active'
--
--  Every other spelling above was only ever READ. They are legacy shapes, not
--  states anything makes. src/utils/projectStatus.js folds them on the way to
--  the screen so old rows keep rendering; this migration stops new ones.
--
--  ONE NAME PER STATE: `in_progress` and `active` meant the same thing, which
--  was the duplication at the root of it. `active` wins — it is what the create
--  path has always written. The closure route's reopen used to write
--  `in_progress` and now writes `active`.
--
--  WHAT THIS TOUCHES ON THIS INSTALLATION
--
--  One project exists, with status 'pending', which is already canonical.
--  PART 2 is therefore expected to update 0 rows. It runs anyway: "expected"
--  is not "verified", and it is what makes this migration safe to run on an
--  installation that is not this one.
--
--  RUN PART 1, then PART 2, then PART 3, then PART 4 (verification, changes
--  nothing). PART 2 MUST come before PART 3 — the constraint is validated
--  against existing rows the moment it is added, so a single stale spelling
--  would abort it.
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - What is actually in there right now
-- ---------------------------------------------------------------------
--  Read first, change nothing. If this returns a value that is not in the
--  fold list below, STOP and add it there before continuing — that is the
--  whole reason this part comes first.

select coalesce(status, '<null>') as status,
       count(*) as projects
from public.projects
group by 1
order by 2 desc, 1;


-- ---------------------------------------------------------------------
--  PART 2 - Fold the old spellings
-- ---------------------------------------------------------------------
--  Mirrors LEGACY_SPELLINGS in src/utils/projectStatus.js. Lower-cased and
--  trimmed on the way in, so 'In Progress' and ' active ' are caught too.

update public.projects
   set status = case lower(btrim(status))
                  when 'in_progress' then 'active'
                  when 'in progress' then 'active'
                  when 'inprogress'  then 'active'
                  when 'assigned'    then 'pending'
                  when 'done'        then 'completed'
                  when 'complete'    then 'completed'
                  when 'on hold'     then 'on_hold'
                  when 'onhold'      then 'on_hold'
                  when 'paused'      then 'on_hold'
                  when 'canceled'    then 'cancelled'
                  when 'archived'    then 'closed'
                  else lower(btrim(status))
                end
 where status is not null
   and status <> case lower(btrim(status))
                  when 'in_progress' then 'active'
                  when 'in progress' then 'active'
                  when 'inprogress'  then 'active'
                  when 'assigned'    then 'pending'
                  when 'done'        then 'completed'
                  when 'complete'    then 'completed'
                  when 'on hold'     then 'on_hold'
                  when 'onhold'      then 'on_hold'
                  when 'paused'      then 'on_hold'
                  when 'canceled'    then 'cancelled'
                  when 'archived'    then 'closed'
                  else lower(btrim(status))
                end;

--  Anything still unrecognised becomes 'pending' — but ONLY after the fold
--  above has had its turn, and only for values no part of the product has ever
--  meant. A row reaching here holds a string nothing wrote deliberately.
--
--  It is 'pending' rather than a refusal because the alternative is PART 3
--  aborting and the whole vocabulary staying unconstrained forever on account
--  of one bad row. What it was is not lost, which is the job PART 1 does: it
--  prints every distinct value with its count BEFORE anything is written, so
--  read that output before running this part and keep it if it shows anything
--  the fold list does not name.
update public.projects
   set status = 'pending'
 where status is null
    or status not in ('pending','active','on_hold','completed','closed','cancelled');


-- ---------------------------------------------------------------------
--  PART 3 - The constraint
-- ---------------------------------------------------------------------
--  NOT NULL is deliberately NOT added. A nullable column with a value list is
--  a smaller change than one that also refuses absence, and PART 2 has already
--  filled every null. Making it required is a separate decision about whether
--  a project may exist without a state at all.

alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status is null or status in
    ('pending','active','on_hold','completed','closed','cancelled'));


-- ---------------------------------------------------------------------
--  PART 4 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  4a. The constraint exists and covers the `status` COLUMN.
--
--      Matched through conkey rather than on the text of the definition. An
--      earlier version of this query in 063 used
--      `pg_get_constraintdef(oid) ilike '%status%'`, which also matched
--      `projects_task_plan_status_check` — a constraint on a DIFFERENT column.
--      It returned that row and read as "status is constrained" when it was
--      not: a false all-clear. Expect exactly one row, projects_status_check.
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join unnest(con.conkey) as k(attnum) on true
join pg_attribute a
  on a.attrelid = con.conrelid and a.attnum = k.attnum
where con.conrelid = 'public.projects'::regclass
  and con.contype = 'c'
  and a.attname = 'status';

--  4b. Every row is now one of the six. Expect one row per status in use, and
--      nothing outside the list.
select status, count(*) as projects
from public.projects
group by 1
order by 2 desc, 1;

--  4c. Nothing is left outside the vocabulary. Expect 0.
select count(*) as rows_outside_vocabulary
from public.projects
where status is not null
  and status not in ('pending','active','on_hold','completed','closed','cancelled');

--  4d. Closure did not move. The timestamps are the truth about closure and
--      this migration touched a text column beside them. Expect the same
--      numbers as before it ran.
select count(*) filter (where closed_at is not null) as closed,
       count(*) filter (where completed_at is not null) as completed,
       count(*) as total
from public.projects;
