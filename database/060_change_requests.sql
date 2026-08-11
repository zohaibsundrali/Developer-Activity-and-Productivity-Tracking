-- =====================================================================
--  060 - change_requests: scope control
-- =====================================================================
--
--  THE PROBLEM THIS EXISTS FOR
--
--  A client says "just one small thing". The project manager says yes because
--  it is one small thing. Three months later the project is forty per cent over
--  budget, nobody can point at when that happened, and the invoice argument is
--  one person's memory against another's. Scope creep is not a planning
--  failure; it is an accounting failure, and it is invisible precisely because
--  every individual yes was reasonable.
--
--  So the unit of work here is not "a request". It is a REQUEST WITH A PRICE
--  ON IT, agreed by both sides before anyone builds anything.
--
--  THE CHAIN
--
--    submitted        raised, by a client or by staff who noticed the scope move
--    estimating       a PM has picked it up and is costing it
--    awaiting_admin   costed; the company has to agree to sell it
--    awaiting_client  the company agreed; the client has to agree to buy it
--    approved         both sides agreed. This is when the project's budget and
--                     deadline actually move
--    implemented      built
--    rejected         declined at any stage, with who and why
--    withdrawn        the raiser pulled it
--
--  Eight states for a five-step chain, and each one has a DIFFERENT person
--  waiting on it — which is the test for whether a state earns its place. A
--  single `rejected` covers refusal by either side rather than splitting into
--  `admin_rejected`/`client_rejected`: the row already records who decided, so
--  two states would encode the same fact twice and let them disagree.
--
--  WHAT MAKES THIS DIFFERENT FROM A COMMENT SAYING "we agreed +£5k"
--
--  On approval the project's budget and deadline MOVE, and the previous values
--  are kept on this row. That is the whole point: a change request that does
--  not change anything is a note, and notes are what the business already had.
--  Keeping the previous values means the trail reads forwards ("the budget went
--  from X to Y on this date because of this request") and can be unwound.
--
--  RUN PART 1, then 2, then 3, then 4 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The table
-- ---------------------------------------------------------------------

create table if not exists public.change_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- Always against a project. A change to nothing is a proposal, and that has
  -- its own table (database/059).
  project_id       uuid not null references public.projects(id) on delete cascade,

  title            text not null,
  description      text not null,

  -- Who raised it. Staff raise these too — noticing that the work has grown is
  -- part of the job, and a request that only a client can file means the
  -- growth nobody asked for stays invisible.
  requested_by     uuid,
  requester_type   text not null default 'client'
                   check (requester_type in ('client', 'staff')),

  status           text not null default 'submitted'
                   check (status in ('submitted','estimating','awaiting_admin',
                                     'awaiting_client','approved','implemented',
                                     'rejected','withdrawn')),

  -- The estimate. Nullable because it does not exist until a PM has looked;
  -- the trigger below refuses to move past `estimating` without it.
  estimated_hours       numeric,
  estimated_cost        numeric,
  currency              text default 'USD',
  timeline_impact_days  integer,
  -- Internal. Never shown to the client — this is where "they will not like
  -- the price" and "we underquoted the original" get written down.
  pm_notes              text,

  -- Decisions, both sides recorded separately because they are separate.
  admin_decided_by   uuid,
  admin_decided_at   timestamptz,
  client_decided_at  timestamptz,
  decision_reason    text,

  -- What the project looked like before this was applied. The audit trail.
  applied_at         timestamptz,
  previous_budget    numeric,
  previous_deadline  date,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_change_requests_project_created
  on public.change_requests (project_id, created_at desc);
create index if not exists idx_change_requests_org_status
  on public.change_requests (organization_id, status, created_at desc);


-- ---------------------------------------------------------------------
--  PART 2 - Rules the database enforces
-- ---------------------------------------------------------------------

create or replace function public.tg_change_request_guard() returns trigger
  language plpgsql
as $fn$
begin
  new.updated_at := now();

  -- A refusal the other side cannot read is a refusal they will ask about by
  -- phone. Same rule as the proposals table, for the same reason.
  if new.status = 'rejected'
     and coalesce(btrim(new.decision_reason), '') = '' then
    raise exception 'A rejected change request needs a reason the other side can read.'
      using errcode = 'check_violation';
  end if;

  -- Nothing goes to either approver without a price. This is the entire
  -- purpose of the table: an unpriced change request is the "just one small
  -- thing" conversation with extra steps.
  if new.status in ('awaiting_admin','awaiting_client','approved','implemented')
     and new.estimated_cost is null and new.estimated_hours is null then
    raise exception
      'Estimate the cost or the hours before sending this for approval.'
      using errcode = 'check_violation';
  end if;

  -- The client's agreement is what `approved` means. Reaching it without one
  -- would let the company approve a bill on the client's behalf.
  if new.status in ('approved','implemented') and new.client_decided_at is null then
    raise exception 'A change request is only approved once the client has agreed.'
      using errcode = 'check_violation';
  end if;

  -- ...and the company's agreement has to come first. Asking the client to
  -- approve something the company has not agreed to sell is how you commit to
  -- work at a price nobody internal signed off.
  if new.status in ('awaiting_client','approved','implemented')
     and new.admin_decided_at is null then
    raise exception 'The company has to approve a change request before the client sees it.'
      using errcode = 'check_violation';
  end if;

  -- Settled means settled. Reopening is a NEW request, which keeps both the
  -- original price and the revised one on the record.
  if tg_op = 'UPDATE'
     and old.status in ('implemented','rejected','withdrawn')
     and new.status is distinct from old.status then
    raise exception 'A % change request cannot be reopened; raise a new one.', old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_change_request_guard on public.change_requests;
create trigger trg_change_request_guard
  before insert or update on public.change_requests
  for each row execute function public.tg_change_request_guard();


-- ---------------------------------------------------------------------
--  PART 3 - Row Level Security
-- ---------------------------------------------------------------------

alter table public.change_requests enable row level security;

-- Stated, not inherited — see the same note in database/059.
grant select, insert, update on public.change_requests to authenticated;
revoke all on public.change_requests from anon;

drop policy if exists change_requests_client_insert on public.change_requests;
drop policy if exists change_requests_client_read   on public.change_requests;
drop policy if exists change_requests_staff_read    on public.change_requests;
drop policy if exists change_requests_staff_write   on public.change_requests;

--  A client raises one against a project it is actually on.
create policy change_requests_client_insert on public.change_requests
  for insert to authenticated
  with check (
    organization_id = public.auth_org()
    and public.auth_is_client()
    and requester_type = 'client'
    and requested_by = public.auth_app_user_id()
    and status = 'submitted'
    and project_id in (select public.auth_client_project_ids())
  );

--  ...and reads the ones on its own projects. Note this includes requests
--  raised by STAFF: if the company decides the scope has grown and wants paying
--  for it, the client is going to be asked to approve it, so hiding it until
--  that moment would be a strange way to run the conversation.
--
--  `pm_notes` is NOT hidden by this policy — RLS is row-level. The column is
--  stripped in the API route instead; see /api/change-requests.
create policy change_requests_client_read on public.change_requests
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and public.auth_is_client()
    and project_id in (select public.auth_client_project_ids())
  );

--  All staff read: a developer being asked "how long would this take?" needs
--  to see what is being asked.
create policy change_requests_staff_read on public.change_requests
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client());

--  Estimating and deciding is owner/admin/manager. team_lead is deliberately
--  out: this is money.
create policy change_requests_staff_write on public.change_requests
  for update to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and public.auth_role() = any (array['owner','admin','manager'])
  )
  with check (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and public.auth_role() = any (array['owner','admin','manager'])
  );

--  Staff may also RAISE one. Same roles: noticing scope has moved and putting
--  a number on it are the same job.
drop policy if exists change_requests_staff_insert on public.change_requests;
create policy change_requests_staff_insert on public.change_requests
  for insert to authenticated
  with check (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and requester_type = 'staff'
    and public.auth_role() = any (array['owner','admin','manager'])
  );


-- ---------------------------------------------------------------------
--  PART 4 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  4a. Expect rls_enabled = t.
select relrowsecurity as rls_enabled
from pg_class where oid = 'public.change_requests'::regclass;

--  4b. Expect five policies, all to `authenticated`, none to anon/public.
select policyname, cmd, roles::text
from pg_policies
where schemaname = 'public' and tablename = 'change_requests'
order by policyname;

--  4c. Expect 0 rows — nothing wide open.
select policyname
from pg_policies
where schemaname = 'public' and tablename = 'change_requests'
  and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');

--  4d. The guard trigger is attached.
select tgname from pg_trigger
where tgrelid = 'public.change_requests'::regclass and not tgisinternal;

--  4e. Neither browser role holds a direct grant it should not.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'change_requests' and grantee = 'anon';
