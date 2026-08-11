-- =====================================================================
--  059 - project_proposals: the client's request for new work
-- =====================================================================
--
--  THE FLOW THIS SUPPORTS
--
--    client submits a proposal
--        -> it lands in Requests, where owner/admin/manager can read it
--        -> decided: accepted / rejected / needs_info
--        -> on accept a project is created, the client is linked to it, and
--           an admin assigns one of several project managers
--        -> from there it is an ordinary project
--
--  WHY A NAMED TABLE AND NOT A GENERIC `requests`
--
--  A generic requests table with a `type` column and a JSON payload looks
--  flexible on day one. By month six every query is reaching through
--  `payload->>'budget'`, nothing can be validated, no foreign key can point at
--  a client or a project, and adding an index means indexing an expression
--  nobody remembers. This table is about ONE thing, so its columns say what
--  they are. If leave requests or resource requests are wanted later they get
--  their own table, which will be smaller than the union of both would be.
--
--  WHAT IT DELIBERATELY DOES NOT DO
--
--  There is no public, unauthenticated submission path here. A proposal can
--  only be filed by a signed-in client of this organization. Opening it to the
--  world is a different feature with a different threat model — rate limiting,
--  captcha, duplicate detection, and account creation on accept — and mixing
--  the two would mean the anti-spam work decides the shape of the table.
--
--  RUN PART 1, then 2, then 3, then 4 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The table
-- ---------------------------------------------------------------------

create table if not exists public.project_proposals (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- Who asked. A proposal always belongs to a client account; there is no
  -- anonymous path (see the note above).
  client_id         uuid not null references public.clients(id) on delete cascade,

  title             text not null,
  description       text not null,
  -- Budget is numeric and nullable rather than free text: "50k", "£50,000" and
  -- "fifty thousand" are the same number to a human and three different
  -- strings to a sort. Nullable because a client genuinely may not know yet,
  -- and forcing a number would just produce fictional ones.
  budget            numeric,
  currency          text default 'USD',
  desired_deadline  date,

  --  submitted   just arrived, nobody has looked
  --  in_review   someone has picked it up
  --  needs_info  sent back with a question; the client can answer and resubmit
  --  accepted    a project exists for it
  --  rejected    declined, with a reason
  --
  --  `needs_info` is the one that earns its place. Without it the only replies
  --  to an underspecified proposal are "no" — losing work over a question that
  --  could have been asked — or "yes", committing to a scope nobody knows.
  status            text not null default 'submitted'
                    check (status in ('submitted','in_review','needs_info','accepted','rejected')),

  -- Required by PART 2's trigger for `rejected` and `needs_info`. A bare
  -- rejection makes the client resubmit the same thing, and a bare
  -- "needs info" does not say which information.
  decision_reason   text,
  decided_by        uuid,
  decided_at        timestamptz,

  -- Set on accept. The admin picks one of possibly several project managers.
  assigned_manager_id uuid,

  -- The project this became. Kept forever, not cleared: six months later,
  -- when the argument is "that was never in scope", the original proposal is
  -- what settles it.
  project_id        uuid references public.projects(id) on delete set null,

  attachment_path   text,
  attachment_name   text,
  attachment_type   text,
  attachment_size   integer,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_proposals_org_status_created
  on public.project_proposals (organization_id, status, created_at desc);
create index if not exists idx_proposals_client
  on public.project_proposals (client_id, created_at desc);

-- The link back from the project, so either end can find the other.
alter table public.projects
  add column if not exists proposal_id uuid references public.project_proposals(id) on delete set null;


-- ---------------------------------------------------------------------
--  PART 2 - Rules the database enforces, not the form
-- ---------------------------------------------------------------------

create or replace function public.tg_proposal_guard() returns trigger
  language plpgsql
as $fn$
begin
  new.updated_at := now();

  -- A decision that closes or bounces a proposal must say why. This is here
  -- rather than in the form because the form is not the only way in: the API
  -- route, a future automation and anyone with the service key all write
  -- through this table, and only one of those reads the form's validation.
  if new.status in ('rejected','needs_info')
     and coalesce(btrim(new.decision_reason), '') = '' then
    raise exception
      'A % decision needs a reason the client can read.', new.status
      using errcode = 'check_violation';
  end if;

  -- An accepted proposal must point at the project it became. Without this an
  -- accept that half-failed leaves a row claiming success with nothing behind
  -- it, and the client is told work has started when it has not.
  if new.status = 'accepted' and new.project_id is null then
    raise exception 'An accepted proposal must reference its project.'
      using errcode = 'check_violation';
  end if;

  -- Decisions are recorded, not implied.
  if new.status <> coalesce(old.status, '')
     and new.status in ('accepted','rejected','needs_info') then
    new.decided_at := coalesce(new.decided_at, now());
  end if;

  -- A settled proposal does not silently become something else. Reopening is
  -- a real action (send it back with `needs_info`), not an UPDATE that nobody
  -- can see afterwards.
  if tg_op = 'UPDATE' and old.status = 'accepted' and new.status <> 'accepted' then
    raise exception 'An accepted proposal cannot be un-accepted; archive the project instead.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_proposal_guard on public.project_proposals;
create trigger trg_proposal_guard
  before insert or update on public.project_proposals
  for each row execute function public.tg_proposal_guard();


-- ---------------------------------------------------------------------
--  PART 3 - Row Level Security
-- ---------------------------------------------------------------------
--
--  A client may file a proposal and watch its own; it may not see another
--  client's, and it may not decide anything. Staff read all of their
--  organization's; only owner/admin/manager may decide.
--
--  Note what is NOT granted: a client cannot UPDATE at all, not even its own
--  row. Letting it edit after submission would mean the proposal an admin read
--  and the one they accepted could differ, with no record of the change. To
--  answer a `needs_info` the client files a new proposal — which leaves both
--  versions on the record, and that is the point.

alter table public.project_proposals enable row level security;

--  GRANTS ARE STATED, NOT INHERITED.
--
--  Supabase sets default privileges that would hand `authenticated` access to
--  a new table in `public` automatically. Relying on that makes the table's
--  reachability depend on a project-level setting nobody reading this file can
--  see — and it means the same migration behaves differently on a fresh
--  database. Saying it here makes the file self-contained. (Caught by the
--  probe suite: without these every policy below was correct and every query
--  still failed with "permission denied".)
--
--  `anon` gets nothing: there is no unauthenticated path to a proposal.
grant select, insert, update on public.project_proposals to authenticated;
revoke all on public.project_proposals from anon;

drop policy if exists proposals_client_insert on public.project_proposals;
drop policy if exists proposals_client_read   on public.project_proposals;
drop policy if exists proposals_staff_read    on public.project_proposals;
drop policy if exists proposals_staff_decide  on public.project_proposals;

--  A client files its own, and only as itself.
create policy proposals_client_insert on public.project_proposals
  for insert to authenticated
  with check (
    organization_id = public.auth_org()
    and public.auth_is_client()
    and client_id = public.auth_app_user_id()
    -- Nobody submits something already decided.
    and status = 'submitted'
    and project_id is null
  );

--  ...and reads its own, and nobody else's.
create policy proposals_client_read on public.project_proposals
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and public.auth_is_client()
    and client_id = public.auth_app_user_id()
  );

--  Staff see every proposal in their organization. Deliberately all staff and
--  not just the deciders: a designer being asked "is this feasible?" should be
--  able to read the thing they are being asked about.
create policy proposals_staff_read on public.project_proposals
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client());

--  Deciding is owner/admin/manager. Not team_lead: accepting commits the
--  company's time and money, and that is a narrower group than task oversight.
create policy proposals_staff_decide on public.project_proposals
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


-- ---------------------------------------------------------------------
--  PART 4 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  4a. Expect rls_enabled = t.
select relrowsecurity as rls_enabled
from pg_class where oid = 'public.project_proposals'::regclass;

--  4b. Expect exactly these four, and no policy granted to anon/public.
select policyname, cmd, roles::text
from pg_policies
where schemaname = 'public' and tablename = 'project_proposals'
order by policyname;

--  4c. Expect 0 rows — no wide-open policy.
select policyname
from pg_policies
where schemaname = 'public' and tablename = 'project_proposals'
  and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');

--  4d. The link column exists on projects.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'projects' and column_name = 'proposal_id';

--  4e. The guard trigger is attached.
select tgname from pg_trigger
where tgrelid = 'public.project_proposals'::regclass and not tgisinternal;
