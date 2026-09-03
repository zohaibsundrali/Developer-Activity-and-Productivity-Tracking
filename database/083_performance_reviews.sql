-- ============================================================================
--  083 - Performance review cycles, reviews, and goals
--
--  WHAT WAS MISSING
--
--  `hr` holds thirty-five permissions and had no way to run the one process
--  every HR function exists to run. `employee_profiles.performance` is a jsonb
--  column described in 015 as "cached rollups (optional)" and nothing has ever
--  written to it -- a place to put an answer, with no process to produce one.
--
--  THE THREE THINGS A REVIEW PROCESS NEEDS, and why each is separate:
--
--    review_cycles         the period being reviewed. Has a start, an end, and
--                          a moment it closes.
--    performance_reviews   one person's assessment of another, inside a cycle.
--    performance_goals     what somebody is meant to achieve. Outlives the
--                          review that set it, which is why it is not a field
--                          on one.
--
--  A REVIEW IS PRIVATE UNTIL IT IS SHARED, and that is the rule this migration
--  most has to get right. A half-written assessment is not feedback; it is a
--  draft somebody would edit if they knew it was being read. So the subject
--  cannot see their own review until its status is 'shared' -- enforced in the
--  RLS policy, not in a route, because these tables are reachable from the
--  browser through PostgREST like every other table in this product.
--
--  NOBODY REVIEWS THEMSELVES. A CHECK, not a convention: self-assessment is a
--  different feature with a different shape, and letting it in through this
--  table would make "who said this" unanswerable.
--
--  NO RATING IS INVENTED. `rating` is nullable and there is no default. A
--  review with no rating is a review somebody has not scored yet, and a 3 that
--  nobody chose is worse than an empty field -- it would average into every
--  report as if it meant something.
--
--  RUN AFTER 082.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - review_cycles
-- ---------------------------------------------------------------------

create table if not exists public.review_cycles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  name             text not null,
  period_start     date not null,
  period_end       date not null,

  -- 'draft' so a cycle can be prepared before anybody is asked to write in it.
  status           text not null default 'draft'
                     check (status in ('draft','open','closed')),

  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint review_cycle_period check (period_end >= period_start)
);

create index if not exists review_cycles_org_idx on public.review_cycles(organization_id, status);


-- ---------------------------------------------------------------------
--  PART 2 - performance_reviews
-- ---------------------------------------------------------------------

create table if not exists public.performance_reviews (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  cycle_id          uuid not null references public.review_cycles(id) on delete cascade,

  -- Loose uuids and not foreign keys, for the reason project_members gives: a
  -- person lives in admin_users OR developers depending on their user_type, and
  -- one column cannot reference two tables.
  subject_user_id   uuid not null,
  reviewer_user_id  uuid not null,

  -- Nullable, deliberately. See the header: a 3 nobody chose averages into
  -- every report as if it meant something.
  rating            integer check (rating is null or rating between 1 and 5),

  strengths         text,
  improvements      text,

  -- 'submitted' means finished and not yet shown to the subject. That middle
  -- state is the whole point: a reviewer needs somewhere to finish before HR
  -- decides the review is ready to be read.
  status            text not null default 'draft'
                      check (status in ('draft','submitted','shared')),

  submitted_at      timestamptz,
  shared_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint review_one_per_reviewer unique (cycle_id, subject_user_id, reviewer_user_id),
  -- NOBODY REVIEWS THEMSELVES. See the header.
  constraint review_not_self check (subject_user_id <> reviewer_user_id)
);

create index if not exists reviews_cycle_idx   on public.performance_reviews(cycle_id, status);
create index if not exists reviews_subject_idx on public.performance_reviews(subject_user_id);
create index if not exists reviews_org_idx     on public.performance_reviews(organization_id);


-- ---------------------------------------------------------------------
--  PART 3 - performance_goals
-- ---------------------------------------------------------------------
--  `cycle_id` is NULLABLE on purpose. A goal set in one review is often still
--  open in the next, and tying it to the cycle that happened to create it would
--  either delete it when that cycle is deleted or make it look finished when
--  the cycle closes. A goal ends when it is met, missed or dropped.

create table if not exists public.performance_goals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  cycle_id         uuid references public.review_cycles(id) on delete set null,

  user_id          uuid not null,

  title            text not null,
  description      text,
  due_date         date,

  status           text not null default 'open'
                     check (status in ('open','met','missed','dropped')),

  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists goals_user_idx on public.performance_goals(user_id, status);
create index if not exists goals_org_idx  on public.performance_goals(organization_id);


-- ---------------------------------------------------------------------
--  PART 4 - a closed cycle is closed
-- ---------------------------------------------------------------------
--  Same shape as the locks in 077 and 081, and for the same structural reason:
--  the browser writes these tables directly, so a rule enforced in a route is
--  advisory.
--
--  SHARING IS STILL ALLOWED ON A CLOSED CYCLE. Closing a cycle ends the writing
--  of reviews, not the reading of them -- an HR lead who closes the cycle and
--  then shares the reviews is doing the normal thing, and a lock that blocked
--  it would force them to reopen the cycle to finish it.

create or replace function public.review_cycle_closed()
returns trigger
language plpgsql
as $$
declare
  v_row    public.performance_reviews;
  v_status text;
begin
  v_row := coalesce(new, old);

  select c.status into v_status
    from public.review_cycles c
   where c.id = v_row.cycle_id;

  if v_status <> 'closed' then
    return v_row;
  end if;

  -- The one edit a closed cycle still permits.
  if tg_op = 'UPDATE' and new.status = 'shared' and old.status <> 'shared' then
    return new;
  end if;

  raise exception
    'That review cycle is closed. Reopen it before changing reviews.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_review_cycle_open on public.performance_reviews;
create trigger trg_review_cycle_open
  before insert or update or delete
  on public.performance_reviews
  for each row execute function public.review_cycle_closed();


-- ---------------------------------------------------------------------
--  PART 5 - cycle progress, in one place
-- ---------------------------------------------------------------------

--  `security_invoker` so this view reads its base tables AS THE CALLER.
--  Without it a view runs with its OWNER's privileges and every RLS policy
--  underneath is skipped -- see 087, which is the migration that had to go
--  and fix all six of these after the fact.
create or replace view public.review_cycle_summary_v
  with (security_invoker = true) as
select
  c.organization_id,
  c.id                                                     as cycle_id,
  c.name,
  c.status,
  c.period_start,
  c.period_end,
  count(r.id)                                              as reviews,
  count(*) filter (where r.status = 'draft')               as drafts,
  count(*) filter (where r.status = 'submitted')           as submitted,
  count(*) filter (where r.status = 'shared')              as shared,
  count(distinct r.subject_user_id)                        as people,
  round(avg(r.rating) filter (where r.rating is not null), 2) as average_rating
from public.review_cycles c
left join public.performance_reviews r on r.cycle_id = c.id
group by c.organization_id, c.id, c.name, c.status, c.period_start, c.period_end;


-- ---------------------------------------------------------------------
--  PART 6 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS MIRROR THE CATALOGUE and cannot import it:
--
--    review_cycle.manage / review.view_all   owner, admin, hr
--    review.write / goal.manage              owner, admin, hr, manager, team_lead
--
--  THE READ POLICY ON performance_reviews IS THE IMPORTANT ONE. Three ways in,
--  and the third is the whole feature:
--
--    1. HR and the owners see every review.
--    2. A reviewer sees the reviews THEY wrote, at any status.
--    3. The subject sees a review about themselves ONLY when it is 'shared'.
--
--  Without the third clause's status test, a subject reads every draft written
--  about them the moment it is typed. With it, a reviewer can think.

alter table public.review_cycles       enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.performance_goals   enable row level security;

--  Cycles are readable by every non-client member: knowing that a review period
--  is open is not confidential, and the subject needs to know one exists.
drop policy if exists review_cycles_read on public.review_cycles;
create policy review_cycles_read on public.review_cycles
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client());

drop policy if exists review_cycles_write on public.review_cycles;
create policy review_cycles_write on public.review_cycles
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false)
               and public.auth_org_unlocked());

drop policy if exists performance_reviews_read on public.performance_reviews;
create policy performance_reviews_read on public.performance_reviews
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      coalesce(public.auth_role() in ('owner','admin','hr'), false)
      or reviewer_user_id = public.auth_app_user_id()
      or (subject_user_id = public.auth_app_user_id() and status = 'shared')
    )
  );

--  A REVIEWER WRITES THEIR OWN REVIEWS AND NOBODY ELSE'S. The subject is not on
--  this policy at all: being reviewed is not a licence to edit the review.
drop policy if exists performance_reviews_write on public.performance_reviews;
create policy performance_reviews_write on public.performance_reviews
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and (coalesce(public.auth_role() in ('owner','admin','hr'), false)
                    or reviewer_user_id = public.auth_app_user_id()))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in
                   ('owner','admin','hr','manager','team_lead'), false)
               and (coalesce(public.auth_role() in ('owner','admin','hr'), false)
                    or reviewer_user_id = public.auth_app_user_id())
               and public.auth_org_unlocked());

--  A goal is not a secret from the person who has to meet it.
drop policy if exists performance_goals_read on public.performance_goals;
create policy performance_goals_read on public.performance_goals
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      user_id = public.auth_app_user_id()
      or coalesce(public.auth_role() in ('owner','admin','hr','manager','team_lead'), false)
    )
  );

drop policy if exists performance_goals_write on public.performance_goals;
create policy performance_goals_write on public.performance_goals
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in
                   ('owner','admin','hr','manager','team_lead'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in
                   ('owner','admin','hr','manager','team_lead'), false)
               and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 7 - verify (read-only)
-- ---------------------------------------------------------------------
--  7a) the three tables exist with RLS on
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('review_cycles','performance_reviews','performance_goals')
 order by c.relname;

--  7b) the summary view resolves
select count(*) as cycle_rows from public.review_cycle_summary_v;

--  7c) nobody reviews themselves. Expect zero rows -- the CHECK makes it
--      impossible, so this is a check on the constraint.
select id, subject_user_id
  from public.performance_reviews
 where subject_user_id = reviewer_user_id;
