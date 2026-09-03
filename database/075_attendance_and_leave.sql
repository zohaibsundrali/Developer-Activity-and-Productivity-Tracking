-- ============================================================================
--  075 - Attendance and Leave
--
--  WHAT THIS IS FOR
--
--  `employee` is a real role in this product with ten permissions and a
--  dashboard, and until now that dashboard was delivery-shaped: My Work, My
--  Timesheet, My Projects. A staff member with no delivery role opened it and
--  found nothing, because the things they actually do all day -- turn up, go
--  home, ask for a day off -- had no table, no key and no screen.
--
--  THERE IS ALREADY AN "ATTENDANCE" NUMBER AND IT IS NOT THIS ONE.
--
--  src/components/admin/TeamStats.jsx renders "Attendance today" from
--  `developer_logins`: it counts anyone whose session logged in inside the last
--  24 hours and divides by headcount. That is a liveness proxy, not attendance.
--  It cannot see somebody who is at work but has not opened the app, it counts
--  somebody who checked email at midnight, and it has no idea what a working
--  day is. It answered a question nobody had asked because it was the only
--  data there was.
--
--  This migration adds the real thing. TeamStats is pointed at it in the same
--  change, and falls back to the login proxy for an organization that has not
--  recorded a day yet -- so the number does not go blank for existing tenants
--  and does not silently mean two things at once.
--
--  NOTHING IS SEEDED THAT WOULD BE AN INVENTION.
--
--  Three leave types are created per organization so the module is usable on
--  first open. Their `annual_quota_days` is NULL, deliberately: "how many
--  annual leave days does this company give" is a policy decision belonging to
--  the organization, and writing 20 there because it is a common answer would
--  put a confident number in front of an HR lead who never chose it. NULL
--  renders as "not set" and the screen asks them to set it.
--
--  RUN AFTER 074. Nothing here is destructive: three new tables, one view, two
--  triggers, and inserts guarded by ON CONFLICT DO NOTHING.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - attendance_records
-- ---------------------------------------------------------------------
--  One row per person per calendar day. The unique constraint is what makes
--  check-in idempotent: a second check-in on the same day updates the row it
--  finds rather than opening a second one, so a double-tapped button cannot
--  produce two half-days.
--
--  `user_id` is a loose uuid and not a foreign key, for the same reason
--  project_members.user_id is: a person lives in `admin_users` OR `developers`
--  depending on their user_type, and one column cannot reference two tables.

create table if not exists public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  user_id          uuid not null,
  user_type        text not null default 'developer'
                     check (user_type in ('admin','developer')),

  work_date        date not null,

  check_in_at      timestamptz,
  check_out_at     timestamptz,

  -- 'on_leave' is written by the leave trigger in PART 4, never by a person.
  -- 'holiday' exists so a company can mark a day closed without every employee
  -- appearing absent; nothing writes it yet and that is fine -- a status the
  -- schema can express is cheaper than a migration later.
  status           text not null default 'present'
                     check (status in ('present','remote','absent','on_leave','holiday')),

  -- Where the row came from. A person's own check-in and an HR correction are
  -- both legitimate and they are not the same fact, so the screen can say which
  -- and an audit can tell them apart.
  source           text not null default 'self'
                     check (source in ('self','manager','hr','system')),

  note             text,
  recorded_by      uuid,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint attendance_one_per_day unique (organization_id, user_id, work_date),
  -- A day that ends before it starts is a data-entry slip, and it silently
  -- produces negative hours everywhere downstream.
  constraint attendance_out_after_in
    check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);

create index if not exists attendance_org_date_idx  on public.attendance_records(organization_id, work_date);
create index if not exists attendance_user_date_idx on public.attendance_records(user_id, work_date);


-- ---------------------------------------------------------------------
--  PART 2 - leave_types
-- ---------------------------------------------------------------------
--  Per-organization configuration. `code` is the stable handle the application
--  matches on; `name` is what the organization decided to call it and may be
--  renamed without breaking anything.

create table if not exists public.leave_types (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,

  code               text not null,
  name               text not null,

  -- NULL means "this organization has not set a quota". See the header: an
  -- invented default is worse than an empty field, because an empty field asks
  -- a question and a wrong number answers one.
  annual_quota_days  numeric(5,1) check (annual_quota_days is null or annual_quota_days >= 0),

  is_paid            boolean not null default true,
  requires_approval  boolean not null default true,
  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint leave_types_code_unique unique (organization_id, code)
);

create index if not exists leave_types_org_idx on public.leave_types(organization_id);


-- ---------------------------------------------------------------------
--  PART 3 - leave_requests
-- ---------------------------------------------------------------------
--  `days` is numeric(4,1) and not an integer because a half day is the most
--  commonly requested leave there is, and a schema that cannot express one
--  forces everybody to round -- in whichever direction they prefer.

create table if not exists public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  user_id          uuid not null,
  user_type        text not null default 'developer'
                     check (user_type in ('admin','developer')),

  leave_type_id    uuid not null references public.leave_types(id) on delete restrict,

  start_date       date not null,
  end_date         date not null,
  days             numeric(4,1) not null check (days > 0),

  reason           text,

  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected','cancelled')),

  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint leave_end_after_start check (end_date >= start_date)
);

create index if not exists leave_req_org_status_idx on public.leave_requests(organization_id, status);
create index if not exists leave_req_user_idx       on public.leave_requests(user_id, start_date);


-- ---------------------------------------------------------------------
--  PART 4 - the two triggers
-- ---------------------------------------------------------------------
--  4a) NO OVERLAPPING LEAVE for the same person.
--
--  Written as a trigger rather than an EXCLUDE constraint on purpose: EXCLUDE
--  over a daterange needs the `btree_gist` extension, and requiring an
--  extension to be enabled is a deployment step that will be missed on exactly
--  one tenant. A trigger needs nothing.
--
--  Only 'pending' and 'approved' rows block. A rejected or cancelled request is
--  history and must not stop somebody asking again for the same days.

create or replace function public.leave_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.status not in ('pending','approved') then
    return new;
  end if;

  if exists (
    select 1
      from public.leave_requests r
     where r.organization_id = new.organization_id
       and r.user_id         = new.user_id
       and r.id             <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
       and r.status in ('pending','approved')
       and r.start_date     <= new.end_date
       and r.end_date       >= new.start_date
  ) then
    raise exception
      'Overlapping leave: this person already has a pending or approved request covering % to %',
      new.start_date, new.end_date
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leave_no_overlap on public.leave_requests;
create trigger trg_leave_no_overlap
  before insert or update of start_date, end_date, status, user_id
  on public.leave_requests
  for each row execute function public.leave_no_overlap();


--  4b) APPROVED LEAVE MARKS THE ATTENDANCE DAYS.
--
--  Without this the two tables disagree the moment leave is approved: the leave
--  screen says "approved" and the attendance screen says "absent", and an HR
--  lead has to reconcile them by hand. Writing 'on_leave' from here is what
--  makes the attendance table answer "where was everybody" correctly.
--
--  Only touches days that have no record or whose record is still the default
--  'absent'/'on_leave' -- a real check-in is a fact about what happened and an
--  approval does not get to overwrite it.

create or replace function public.leave_apply_to_attendance()
returns trigger
language plpgsql
as $$
declare
  d date;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return new;
  end if;

  d := new.start_date;
  while d <= new.end_date loop
    insert into public.attendance_records
      (organization_id, user_id, user_type, work_date, status, source, note)
    values
      (new.organization_id, new.user_id, new.user_type, d, 'on_leave', 'system',
       'Approved leave #' || left(new.id::text, 8))
    on conflict (organization_id, user_id, work_date) do update
      set status     = 'on_leave',
          source     = 'system',
          updated_at = now()
      where public.attendance_records.status in ('absent','on_leave');
    d := d + 1;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_leave_apply_attendance on public.leave_requests;
create trigger trg_leave_apply_attendance
  after insert or update of status
  on public.leave_requests
  for each row execute function public.leave_apply_to_attendance();


-- ---------------------------------------------------------------------
--  PART 5 - leave balance, as a VIEW
-- ---------------------------------------------------------------------
--  Derived, not stored. A `leave_balances` table would need updating from four
--  places -- approval, rejection, cancellation and the yearly reset -- and the
--  first one anybody forgets makes every balance in the organization wrong with
--  nothing to show it. Taken is a `sum()` over approved rows, so it cannot
--  drift from the rows it describes.
--
--  `remaining` is NULL when the quota is NULL, and that is the honest answer:
--  an organization that has not set a quota has no remaining figure, and 0
--  would read as "you have none left".

--  `security_invoker` so this view reads its base tables AS THE CALLER.
--  Without it a view runs with its OWNER's privileges and every RLS policy
--  underneath is skipped -- see 087, which is the migration that had to go
--  and fix all six of these after the fact.
create or replace view public.leave_balances_v
  with (security_invoker = true) as
select
  lt.organization_id,
  r.user_id,
  lt.id                       as leave_type_id,
  lt.code,
  lt.name,
  extract(year from r.start_date)::int as leave_year,
  lt.annual_quota_days,
  coalesce(sum(r.days) filter (where r.status = 'approved'), 0)::numeric(6,1) as taken_days,
  coalesce(sum(r.days) filter (where r.status = 'pending'),  0)::numeric(6,1) as pending_days,
  case
    when lt.annual_quota_days is null then null
    else (lt.annual_quota_days
          - coalesce(sum(r.days) filter (where r.status = 'approved'), 0))::numeric(6,1)
  end as remaining_days
from public.leave_requests r
join public.leave_types lt on lt.id = r.leave_type_id
group by lt.organization_id, r.user_id, lt.id, lt.code, lt.name,
         extract(year from r.start_date), lt.annual_quota_days;


-- ---------------------------------------------------------------------
--  PART 6 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS HERE MIRROR THE CATALOGUE and cannot import it, which is the
--  same standing problem every policy file in this repo has. The pairing is:
--
--    attendance.view_all / leave.view_all / leave.approve  owner, admin, hr, manager
--    attendance.manage   / leave.manage_types              owner, admin, hr
--
--  tests/attendanceAndLeave.test.js asserts these lists against
--  permissionCatalogue.js by reading this file, so a change to one that is not
--  made to the other fails rather than drifting.
--
--  EVERYBODY READS THEIR OWN ROW unconditionally. That is not a permission
--  being generous, it is the floor: a person who cannot read their own leave
--  request cannot be told whether it was approved.

alter table public.attendance_records enable row level security;
alter table public.leave_types        enable row level security;
alter table public.leave_requests     enable row level security;

-- ---- attendance ----
drop policy if exists attendance_read on public.attendance_records;
create policy attendance_read on public.attendance_records
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      user_id = public.auth_app_user_id()
      or coalesce(public.auth_role() in ('owner','admin','hr','manager'), false)
    )
  );

--  A person writes their OWN attendance and nobody else's. Correcting somebody
--  else's day is `attendance.manage` and is owner/admin/hr -- deliberately not
--  manager, who may READ the team's attendance but not rewrite it, because a
--  record somebody's own manager can edit is not a record.
drop policy if exists attendance_write_own on public.attendance_records;
create policy attendance_write_own on public.attendance_records
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and user_id = public.auth_app_user_id())
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and user_id = public.auth_app_user_id()
               and public.auth_org_unlocked());

drop policy if exists attendance_write_hr on public.attendance_records;
create policy attendance_write_hr on public.attendance_records
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false)
               and public.auth_org_unlocked());

-- ---- leave types ----
--  Readable by every non-client member: you cannot ask for a kind of leave you
--  cannot see exists.
drop policy if exists leave_types_read on public.leave_types;
create policy leave_types_read on public.leave_types
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client());

drop policy if exists leave_types_write on public.leave_types;
create policy leave_types_write on public.leave_types
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false)
               and public.auth_org_unlocked());

-- ---- leave requests ----
drop policy if exists leave_requests_read on public.leave_requests;
create policy leave_requests_read on public.leave_requests
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      user_id = public.auth_app_user_id()
      or coalesce(public.auth_role() in ('owner','admin','hr','manager'), false)
    )
  );

--  RAISING one is your own act; DECIDING one is somebody else's.
--
--  The insert path is deliberately narrow: a person may write a row for
--  themselves. It does NOT let them approve it -- `status` is checked below,
--  and the API route refuses anything but 'pending' on create. The database is
--  the floor under that, not a restatement of it: without the status clause,
--  the browser's own PostgREST client could insert an already-approved row.
drop policy if exists leave_requests_write_own on public.leave_requests;
create policy leave_requests_write_own on public.leave_requests
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and user_id = public.auth_app_user_id())
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and user_id = public.auth_app_user_id()
               and status in ('pending','cancelled')
               and public.auth_org_unlocked());

drop policy if exists leave_requests_decide on public.leave_requests;
create policy leave_requests_decide on public.leave_requests
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr','manager'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr','manager'), false)
               and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 7 - default leave types, per organization
-- ---------------------------------------------------------------------
--  Quotas are NULL on purpose. See the header.
--  ON CONFLICT DO NOTHING, so re-running 075 changes nothing and an
--  organization that has renamed or deleted these keeps its own decision.

insert into public.leave_types (organization_id, code, name, is_paid, requires_approval)
select o.id, t.code, t.name, t.is_paid, true
  from public.organizations o
 cross join (values
   ('annual', 'Annual Leave', true),
   ('sick',   'Sick Leave',   true),
   ('unpaid', 'Unpaid Leave', false)
 ) as t(code, name, is_paid)
on conflict (organization_id, code) do nothing;


-- ---------------------------------------------------------------------
--  PART 8 - verify (read-only)
-- ---------------------------------------------------------------------
--  8a) the three tables exist and have RLS on
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('attendance_records','leave_types','leave_requests')
 order by c.relname;

--  8b) every organization has its default leave types (expect 3 each)
select o.id as organization_id, o.name, count(lt.id) as leave_types
  from public.organizations o
  left join public.leave_types lt on lt.organization_id = o.id
 group by o.id, o.name
 order by leave_types asc, o.name;

--  8c) the balance view resolves
select count(*) as balance_rows from public.leave_balances_v;
