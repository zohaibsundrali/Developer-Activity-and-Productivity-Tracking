-- ============================================================================
--  079 - Invoicing from approved hours, and project P&L
--
--  WHAT WAS ALREADY HERE, AND WHAT IT COULD NOT DO
--
--  `public.invoices` has existed since 014. It has one `amount` column, typed
--  by hand in ClientManagement.jsx, with no breakdown of any kind. So an
--  invoice could say "$4,000" and nothing in the system could say what those
--  four thousand dollars were FOR -- which hours, whose, on what. The client
--  portal renders that number to the client, who has even less to go on.
--
--  Migration 077 made hours agreeable: a week is submitted, approved, and
--  locked. That is the missing half. This migration joins the two, so an
--  invoice line can be "40 approved billable hours, Ayesha, week of 31 Aug"
--  and the number follows from the work instead of from somebody's memory.
--
--  THE SAME HOURS MUST NOT BE BILLED TWICE, and that is not a UI concern:
--  `invoices` is written straight from the browser through PostgREST (see
--  ClientManagement.jsx), so the rule has to hold in the database or it does
--  not hold. It is keyed on (organization_id, project_id, user_id, week_start)
--  for timesheet-sourced lines and ignores voided invoices -- a voided
--  invoice's hours are unbilled again, which is the whole point of voiding one.
--  PART 2 explains why that ended up a trigger rather than the unique index it
--  ought to have been.
--
--  RATES ARE NULL AND THAT IS THE HONEST STATE.
--
--  Three rate columns are added and every one of them starts NULL. What an hour
--  is worth is a commercial decision this migration has no business making: a
--  plausible-looking 100 would price every project in the system, and the first
--  anybody would know is an invoice going out at a number nobody chose. The
--  screens show "rate not set" and refuse to bill a line without one.
--
--  COST RATES ARE SALARIES BY ANOTHER NAME. `employee_profiles.cost_rate` says
--  what a person costs per hour, which is what they are paid, spread out. It is
--  why `pnl.view` is owner/admin/finance and NOT manager: a manager needs their
--  project's margin far less than their team needs their pay kept private.
--
--  RUN AFTER 078.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - the three rates
-- ---------------------------------------------------------------------
--  MOST SPECIFIC WINS: a person's rate on a project beats the project's
--  default. Both may be null, and null is not zero -- it means "nobody has said
--  yet", which is a different fact and produces a different screen.

alter table public.project_members
  add column if not exists bill_rate numeric(12,2)
    check (bill_rate is null or bill_rate >= 0);

alter table public.projects
  add column if not exists default_bill_rate numeric(12,2)
    check (default_bill_rate is null or default_bill_rate >= 0);

--  What the person costs US. Deliberately org-wide rather than per project:
--  somebody's cost does not change because they moved to another project, and a
--  per-project cost rate would be four places to update one salary.
alter table public.employee_profiles
  add column if not exists cost_rate numeric(12,2)
    check (cost_rate is null or cost_rate >= 0);

--  ONE definition of "what do we bill for this person on this project".
--  Three call sites resolving it themselves is how they stop agreeing.
create or replace function public.bill_rate_for(p_project uuid, p_user uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select pm.bill_rate
       from public.project_members pm
      where pm.project_id = p_project
        and pm.user_id    = p_user
        and pm.bill_rate is not null
      limit 1),
    (select p.default_bill_rate from public.projects p where p.id = p_project)
  );
$$;


-- ---------------------------------------------------------------------
--  PART 2 - invoice_lines
-- ---------------------------------------------------------------------
--  `amount` is stored rather than generated, because a rate may be corrected
--  later and a line that silently re-prices itself after the invoice was sent
--  is not a record of anything. Quantity x rate at the moment the line was
--  written, kept.

create table if not exists public.invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,

  description      text not null,

  -- Hours, to two decimals. A half hour is the smallest unit anybody bills.
  quantity         numeric(10,2) not null check (quantity > 0),
  unit_rate        numeric(12,2) not null check (unit_rate >= 0),
  amount           numeric(12,2) not null check (amount >= 0),

  source           text not null default 'manual'
                     check (source in ('timesheet','manual')),

  -- Set only for source = 'timesheet'. Together these name exactly the hours
  -- this line bills, which is what makes double-billing detectable at all.
  project_id       uuid references public.projects(id) on delete set null,
  user_id          uuid,
  week_start       date,

  created_by       uuid,
  created_at       timestamptz not null default now(),

  -- A timesheet line has to say which hours it is. Without this a line could
  -- claim to come from a timesheet and name none, and the guard below would
  -- compare three nulls against three nulls and let every one of them through.
  constraint invoice_line_timesheet_identified check (
    source <> 'timesheet'
    or (project_id is not null and user_id is not null and week_start is not null)
  )
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index if not exists invoice_lines_org_idx     on public.invoice_lines(organization_id);

--  THE DOUBLE-BILLING GUARD -- and why it is a trigger.
--
--  The obvious form is a partial unique index over (organization_id,
--  project_id, user_id, week_start) restricted to live invoices. Postgres will
--  not have it: an index predicate must be immutable and may not contain a
--  subquery, so it cannot see the invoice's status. An index that ignored
--  status would be worse than none here, because voiding an invoice has to
--  RELEASE its hours -- that is what voiding is for -- and the released hours
--  could then never be billed again.
--
--  So the rule lives in a trigger, which can look. The honest cost of that
--  choice: two concurrent inserts of the same line could both pass the check
--  before either commits. That is a race between two people billing the same
--  person-week on the same project in the same instant, on a screen only
--  owner/admin/finance can open. Worth naming, not worth denormalising the
--  invoice's status onto every line to close.
create or replace function public.invoice_line_not_already_billed()
returns trigger
language plpgsql
as $$
begin
  if new.source <> 'timesheet' then
    return new;
  end if;

  if exists (
    select 1
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where il.source          = 'timesheet'
       and il.organization_id = new.organization_id
       and il.project_id      = new.project_id
       and il.user_id         = new.user_id
       and il.week_start      = new.week_start
       and il.id             <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
       and i.status          <> 'void'
  ) then
    raise exception
      'Those hours are already on a live invoice (project %, week of %).',
      new.project_id, new.week_start
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoice_line_not_billed on public.invoice_lines;
create trigger trg_invoice_line_not_billed
  before insert or update of project_id, user_id, week_start, source, invoice_id
  on public.invoice_lines
  for each row execute function public.invoice_line_not_already_billed();


-- ---------------------------------------------------------------------
--  PART 3 - keep invoices.amount true
-- ---------------------------------------------------------------------
--  `invoices.amount` is what the client portal renders and what
--  ClientManagement lists. Adding lines beside it without keeping it in step
--  would leave the total the client sees disagreeing with the lines the client
--  sees, which is worse than having no lines at all.
--
--  An invoice with NO lines is untouched. Every invoice written before today is
--  exactly that, so nothing that exists changes value.

create or replace function public.invoice_sync_amount()
returns trigger
language plpgsql
as $$
declare
  v_invoice uuid;
  v_total   numeric(12,2);
  v_count   integer;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);

  select count(*), coalesce(sum(amount), 0)
    into v_count, v_total
    from public.invoice_lines
   where invoice_id = v_invoice;

  if v_count > 0 then
    update public.invoices set amount = v_total where id = v_invoice;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_invoice_lines_sync on public.invoice_lines;
create trigger trg_invoice_lines_sync
  after insert or update or delete
  on public.invoice_lines
  for each row execute function public.invoice_sync_amount();


-- ---------------------------------------------------------------------
--  PART 4 - what is billable and not yet billed
-- ---------------------------------------------------------------------
--  APPROVED ONLY. A week that has not been signed off is not something to send
--  a client, and 077 is what made "signed off" mean anything.
--
--  One row per (project, person, week): that is the grain an invoice line bills
--  at, and matching the two means the double-billing index can do its job.
--
--  `rate` may be NULL. The screen shows those rows and refuses to bill them,
--  rather than hiding hours somebody worked because nobody set a price.

create or replace view public.billable_hours_v as
--  AGGREGATED FIRST, THEN ASKED ABOUT.
--
--  The obvious shape puts the `exists (... invoiced ...)` in the select list of
--  the grouped query and correlates it on `public.timesheet_week_of(
--  l.started_at)`. Postgres refuses it:
--
--    42803: subquery uses ungrouped column "l.started_at" from outer query
--
--  It will match a grouped EXPRESSION in the select list, but inside a sublink
--  it sees the bare column and cannot tell that the whole expression is the one
--  being grouped by. So the week is computed and grouped in `agg`, and the
--  correlation below is against a plain column that is unambiguously grouped.
with agg as (
  select
    l.organization_id,
    l.project_id,
    l.developer_id                         as user_id,
    public.timesheet_week_of(l.started_at) as week_start,
    sum(l.seconds)                         as seconds
  from public.task_time_logs l
  join public.timesheets t
    on  t.organization_id = l.organization_id
    and t.user_id         = l.developer_id
    and t.week_start      = public.timesheet_week_of(l.started_at)
    and t.status          = 'approved'
  where l.is_billable
    and l.seconds is not null
    and l.project_id is not null
  group by l.organization_id, l.project_id, l.developer_id,
           public.timesheet_week_of(l.started_at)
)
select
  a.organization_id,
  a.project_id,
  -- Joined in rather than looked up by the screen: the list groups by project,
  -- and a second round trip per group to learn a name is a screen that renders
  -- "Project" until it finishes.
  p.name                                        as project_name,
  a.user_id,
  a.week_start,
  round(a.seconds::numeric / 3600, 2)           as hours,
  public.bill_rate_for(a.project_id, a.user_id) as rate,
  exists (
    select 1
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where il.source          = 'timesheet'
       and il.organization_id = a.organization_id
       and il.project_id      = a.project_id
       and il.user_id         = a.user_id
       and il.week_start      = a.week_start
       and i.status          <> 'void'
  )                                             as invoiced
from agg a
join public.projects p on p.id = a.project_id;


-- ---------------------------------------------------------------------
--  PART 5 - project P&L
-- ---------------------------------------------------------------------
--  Revenue is what has been INVOICED, not what could be. A pipeline number
--  dressed as revenue is how a project looks profitable until somebody tries to
--  collect.
--
--  Cost is approved hours x the person's cost_rate, and is NULL -- not zero --
--  for any project where a cost rate is missing, with `costed_hours` beside
--  `total_hours` so the gap is visible. A margin computed as if unpriced people
--  were free is the single most misleading number this view could produce.

create or replace view public.project_pnl_v as
with hours as (
  select
    l.organization_id,
    l.project_id,
    round(sum(l.seconds)::numeric / 3600, 2) as total_hours,
    round(sum(l.seconds) filter (where ep.cost_rate is not null)::numeric / 3600, 2)
      as costed_hours,
    sum((l.seconds::numeric / 3600) * ep.cost_rate) as cost
  from public.task_time_logs l
  join public.timesheets t
    on  t.organization_id = l.organization_id
    and t.user_id         = l.developer_id
    and t.week_start      = public.timesheet_week_of(l.started_at)
    and t.status          = 'approved'
  -- LATERAL WITH A LIMIT, NOT A PLAIN JOIN, and this is not a style choice.
  --
  -- `employee_profiles` is unique on (organization_id, user_id, USER_TYPE), so
  -- one person legitimately holds two rows once they move between the admin and
  -- developer profile tables — a developer promoted to admin is exactly that.
  -- A plain left join then matches each of their time logs twice and the sums
  -- above double: not a missing number, a confidently wrong one, on the screen
  -- that decides whether a project made money.
  --
  -- Same reason `bill_rate_for()` limits to one row.
  left join lateral (
    select ep2.cost_rate
      from public.employee_profiles ep2
     where ep2.organization_id = l.organization_id
       and ep2.user_id         = l.developer_id
       and ep2.cost_rate is not null
     limit 1
  ) ep on true
  where l.seconds is not null
    and l.project_id is not null
  group by l.organization_id, l.project_id
),
revenue as (
  select organization_id, project_id,
         sum(amount) as invoiced
    from public.invoices
   where status <> 'void'
     and project_id is not null
   group by organization_id, project_id
)
select
  p.organization_id,
  p.id                                   as project_id,
  p.name                                 as project_name,
  coalesce(r.invoiced, 0)::numeric(12,2) as invoiced,
  coalesce(h.total_hours, 0)             as total_hours,
  coalesce(h.costed_hours, 0)            as costed_hours,
  h.cost::numeric(12,2)                  as cost,
  case
    when h.cost is null then null
    else (coalesce(r.invoiced, 0) - h.cost)::numeric(12,2)
  end                                    as margin
from public.projects p
left join hours   h on h.project_id = p.id
left join revenue r on r.project_id = p.id;


-- ---------------------------------------------------------------------
--  PART 6 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LIST MIRRORS THE CATALOGUE and cannot import it:
--
--    invoice.view / invoice.manage / pnl.view    owner, admin, finance
--
--  A CLIENT READS THE LINES OF THEIR OWN INVOICE. 014 already lets them read
--  the invoice; showing a total with no breakdown is exactly the complaint this
--  migration exists to answer, and the breakdown of a bill is the payer's
--  business. They read hours and rates on their own work only -- never a cost
--  rate, which appears in no policy below and in no view they can reach.

alter table public.invoice_lines enable row level security;

drop policy if exists invoice_lines_staff on public.invoice_lines;
create policy invoice_lines_staff on public.invoice_lines
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false)
               and public.auth_org_unlocked());

drop policy if exists invoice_lines_client_read on public.invoice_lines;
create policy invoice_lines_client_read on public.invoice_lines
  for select to authenticated
  using (
    public.auth_is_client()
    and exists (
      select 1
        from public.invoices i
       where i.id = invoice_lines.invoice_id
         and i.project_id in (select public.auth_client_project_ids())
    )
  );


-- ---------------------------------------------------------------------
--  PART 7 - verify (read-only)
-- ---------------------------------------------------------------------
--  7a) the rate columns landed, and are all NULL as intended
select 'project_members.bill_rate'  as col, count(bill_rate)         as set_so_far, count(*) as rows from public.project_members
union all
select 'projects.default_bill_rate', count(default_bill_rate), count(*) from public.projects
union all
select 'employee_profiles.cost_rate', count(cost_rate), count(*) from public.employee_profiles;

--  7b) the two views resolve
select count(*) as billable_rows from public.billable_hours_v;
select count(*) as pnl_rows      from public.project_pnl_v;

--  7c) nothing is double-billed on LIVE invoices. Expect zero rows. Voided
--      invoices are excluded on purpose -- their hours are released, so the
--      same week legitimately appears again on the invoice that replaced them.
select il.project_id, il.user_id, il.week_start, count(*) as live_lines
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
 where il.source = 'timesheet'
   and i.status <> 'void'
 group by il.project_id, il.user_id, il.week_start
having count(*) > 1;
