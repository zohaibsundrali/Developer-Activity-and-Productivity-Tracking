-- ============================================================================
--  085 - Job openings, candidates, and the hiring pipeline
--
--  WHAT WAS MISSING
--
--  Everything about a person AFTER they join exists: memberships,
--  employee_profiles, onboarding, attendance, reviews. Nothing about them
--  before. `employee.onboard` has been a permission since 058 with no process
--  in front of it -- somebody arrives already hired, from nowhere.
--
--  CANDIDATES ARE THE MOST SENSITIVE ROWS IN THIS PRODUCT, and the RLS below is
--  written first with that in mind. A candidate is a named person outside the
--  organization who has not agreed to anything: their email, their phone, their
--  CV and somebody's private opinion of them. That is a stricter category than
--  an employee record, and it is why `candidate.view` is owner/admin/hr and not
--  the wider people-reading set that opens the Employees screen.
--
--  THE HIRING MANAGER IS THE ONE EXCEPTION, and it is granted on the OPENING
--  rather than on a key: whoever is named `hiring_manager_id` on a job opening
--  can see that opening's candidates and nobody else's. Same shape as a
--  reviewer reading the reviews they wrote in 083 -- a fact about the row, not
--  a role.
--
--  NO CV UPLOAD, AND THAT IS DELIBERATE. `resume_url` is a link, not a storage
--  path. A private bucket for CVs is a real piece of work -- its own policies,
--  its own retention question, its own deletion story for a candidate who asks
--  to be forgotten -- and a column pointing at a bucket nobody created would be
--  a promise the schema cannot keep. A link is honest about what it is.
--
--  RUN AFTER 084.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - job_openings
-- ---------------------------------------------------------------------

create table if not exists public.job_openings (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  department_id     uuid references public.departments(id) on delete set null,

  title             text not null,
  description       text,
  location          text,

  employment_type   text
                      check (employment_type is null or
                             employment_type in ('full_time','part_time','contract','intern')),

  -- The role this opening will become. Constrained to the catalogue's own
  -- vocabulary so a hire lands on a role the product actually has, rather than
  -- on free text somebody has to translate later.
  target_role       text
                      check (target_role is null or target_role in
                             ('manager','hr','finance','team_lead','qa','developer',
                              'designer','devops','employee')),

  -- Whoever is named here can see this opening's candidates. See the header:
  -- granted on the row, not on a role.
  hiring_manager_id uuid,

  openings_count    integer not null default 1 check (openings_count >= 1),

  status            text not null default 'draft'
                      check (status in ('draft','open','on_hold','closed','filled')),

  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists job_openings_org_idx on public.job_openings(organization_id, status);


-- ---------------------------------------------------------------------
--  PART 2 - candidates
-- ---------------------------------------------------------------------
--  `stage` and `outcome` are SEPARATE, and that is the one modelling decision
--  worth arguing about here. A single status list mixing 'interview' with
--  'rejected' cannot answer "how many people did we reject AT interview" --
--  the moment somebody is rejected, the stage they reached is overwritten and
--  the only interesting question about the pipeline becomes unanswerable.
--
--  So: stage says how far they got. outcome says how it ended, and is null
--  while they are still in play.

create table if not exists public.candidates (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  job_opening_id    uuid not null references public.job_openings(id) on delete cascade,

  full_name         text not null,
  email             text not null,
  phone             text,

  -- A link, not a storage path. See the header.
  resume_url        text,
  source            text,

  stage             text not null default 'applied'
                      check (stage in ('applied','screening','interview','offer','hired')),

  outcome           text
                      check (outcome is null or outcome in ('rejected','withdrawn','hired')),

  notes             text,

  -- Set when a candidate becomes a member. NOT a foreign key and NOT an
  -- account: creating a login is `member.provision` and a separate act with a
  -- separate permission. This only records that the two are the same person.
  hired_user_id     uuid,

  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One application per person per opening. Case-insensitive, because
  -- "A@x.com" and "a@x.com" are the same applicant and two rows would split
  -- their history in half.
  constraint candidates_one_per_opening unique (organization_id, job_opening_id, email)
);

create index if not exists candidates_opening_idx on public.candidates(job_opening_id, stage);
create index if not exists candidates_org_idx     on public.candidates(organization_id);

--  Normalise the email so the unique constraint above actually holds. Doing it
--  in a trigger rather than trusting every caller: the browser writes this
--  table directly, and one route lower-casing while another does not is how
--  the duplicate everybody was trying to prevent gets in.
create or replace function public.candidate_normalise_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(btrim(new.email));
  if new.email = '' then
    raise exception 'A candidate needs an email address' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_candidate_normalise_email on public.candidates;
create trigger trg_candidate_normalise_email
  before insert or update of email
  on public.candidates
  for each row execute function public.candidate_normalise_email();


-- ---------------------------------------------------------------------
--  PART 3 - candidate_events
-- ---------------------------------------------------------------------
--  THE PIPELINE IS THE POINT OF AN ATS. Without a history, "we have four people
--  at interview" is all you can ever say; with one, you can say how long they
--  have been there and where everybody else fell out.
--
--  Append-only by intention: there is no update path in the API and the RLS
--  policy grants insert and select but not update or delete.

create table if not exists public.candidate_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  candidate_id     uuid not null references public.candidates(id) on delete cascade,

  from_stage       text,
  to_stage         text,
  outcome          text,
  note             text,

  actor_user_id    uuid,
  created_at       timestamptz not null default now()
);

create index if not exists candidate_events_candidate_idx
  on public.candidate_events(candidate_id, created_at desc);


-- ---------------------------------------------------------------------
--  PART 4 - a decided candidate stays decided
-- ---------------------------------------------------------------------
--  Once somebody is rejected, withdrawn or hired, their stage stops moving.
--  Not because reversing a decision is unthinkable, but because doing it
--  silently rewrites what the pipeline says happened -- the honest way back is
--  to clear the outcome first, which this permits and records.
--
--  A trigger rather than a route check, for the reason every lock in this
--  schema is: the browser writes this table directly through PostgREST.

create or replace function public.candidate_outcome_final()
returns trigger
language plpgsql
as $$
begin
  if old.outcome is null then
    return new;
  end if;

  -- Clearing the outcome is the way back, and it is allowed.
  if new.outcome is null then
    return new;
  end if;

  if new.stage is distinct from old.stage or new.outcome is distinct from old.outcome then
    raise exception
      'That candidate is already %. Clear the outcome before moving them again.',
      old.outcome
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_candidate_outcome_final on public.candidates;
create trigger trg_candidate_outcome_final
  before update on public.candidates
  for each row execute function public.candidate_outcome_final();


-- ---------------------------------------------------------------------
--  PART 5 - the pipeline, counted
-- ---------------------------------------------------------------------
--  Counts of people still IN PLAY per stage, plus how each closed one ended.
--  `in_play` excludes anybody with an outcome, which is why stage and outcome
--  had to be separate columns.

--  `security_invoker` so this view reads its base tables AS THE CALLER.
--  Without it a view runs with its OWNER's privileges and every RLS policy
--  underneath is skipped -- see 087, which is the migration that had to go
--  and fix all six of these after the fact.
create or replace view public.job_opening_pipeline_v
  with (security_invoker = true) as
select
  o.organization_id,
  o.id                                                              as job_opening_id,
  o.title,
  o.status,
  o.openings_count,
  o.hiring_manager_id,
  count(c.id)                                                       as candidates,
  count(*) filter (where c.outcome is null)                         as in_play,
  count(*) filter (where c.outcome is null and c.stage = 'applied')   as applied,
  count(*) filter (where c.outcome is null and c.stage = 'screening') as screening,
  count(*) filter (where c.outcome is null and c.stage = 'interview') as interview,
  count(*) filter (where c.outcome is null and c.stage = 'offer')     as offer,
  count(*) filter (where c.outcome = 'hired')                       as hired,
  count(*) filter (where c.outcome = 'rejected')                    as rejected,
  count(*) filter (where c.outcome = 'withdrawn')                   as withdrawn
from public.job_openings o
left join public.candidates c on c.job_opening_id = o.id
group by o.organization_id, o.id, o.title, o.status, o.openings_count, o.hiring_manager_id;


-- ---------------------------------------------------------------------
--  PART 6 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS MIRROR THE CATALOGUE and cannot import it:
--
--    job.view                          owner, admin, hr, manager, team_lead
--    job.manage / candidate.*          owner, admin, hr
--
--  AN OPENING IS NOT PII; A CANDIDATE IS. That asymmetry is the whole policy
--  design. Knowing the company is hiring a QA engineer is ordinary workplace
--  information. Knowing that a named person applied, what they earn now and
--  what an interviewer thought of them is not, and it is information about
--  somebody who is not in this organization and never agreed to be discussed
--  in it.
--
--  The hiring manager clause is granted on `hiring_manager_id`, a fact about
--  the row, exactly as a reviewer's access in 083 is granted on authorship.

alter table public.job_openings     enable row level security;
alter table public.candidates       enable row level security;
alter table public.candidate_events enable row level security;

drop policy if exists job_openings_read on public.job_openings;
create policy job_openings_read on public.job_openings
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_role() in
             ('owner','admin','hr','manager','team_lead'), false));

drop policy if exists job_openings_write on public.job_openings;
create policy job_openings_write on public.job_openings
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false)
               and public.auth_org_unlocked());

drop policy if exists candidates_read on public.candidates;
create policy candidates_read on public.candidates
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      coalesce(public.auth_role() in ('owner','admin','hr'), false)
      or exists (
        select 1
          from public.job_openings o
         where o.id = candidates.job_opening_id
           and o.hiring_manager_id = public.auth_app_user_id()
      )
    )
  );

--  WRITING IS NARROWER THAN READING. A hiring manager may see their opening's
--  candidates and may not edit them: moving somebody through a pipeline is a
--  record of a decision, and the person who made it should be the one who
--  writes it down.
drop policy if exists candidates_write on public.candidates;
create policy candidates_write on public.candidates
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false)
               and public.auth_org_unlocked());

--  Events follow the candidate they belong to: if you may read the person, you
--  may read their history. SELECT and INSERT only -- no update, no delete. An
--  append-only log that can be edited is not a log.
drop policy if exists candidate_events_read on public.candidate_events;
create policy candidate_events_read on public.candidate_events
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and exists (
      select 1
        from public.candidates c
        join public.job_openings o on o.id = c.job_opening_id
       where c.id = candidate_events.candidate_id
         and (coalesce(public.auth_role() in ('owner','admin','hr'), false)
              or o.hiring_manager_id = public.auth_app_user_id())
    )
  );

drop policy if exists candidate_events_insert on public.candidate_events;
create policy candidate_events_insert on public.candidate_events
  for insert to authenticated
  with check (organization_id = public.auth_org()
              and not public.auth_is_client()
              and coalesce(public.auth_role() in ('owner','admin','hr'), false)
              and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 7 - verify (read-only)
-- ---------------------------------------------------------------------
--  7a) the three tables exist with RLS on
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('job_openings','candidates','candidate_events')
 order by c.relname;

--  7b) the pipeline view resolves
select count(*) as opening_rows from public.job_opening_pipeline_v;

--  7c) every stored email is already normalised. Expect zero rows -- the
--      trigger makes it so, which is what this checks.
select id, email
  from public.candidates
 where email <> lower(btrim(email));
