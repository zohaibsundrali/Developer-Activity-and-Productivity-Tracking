-- ============================================================================
--  092 - Client contracts, milestones, and amendments
--
--  WHAT WAS MISSING
--
--  The commercial chain was complete at both ends and empty in the middle. A
--  client could raise a proposal (014), the work could be planned, tracked,
--  approved and invoiced (079) -- and nothing anywhere recorded what had
--  actually been AGREED. The invoice was the first written commitment in the
--  entire system, which is the wrong way round: an invoice is a consequence of
--  a contract, not a substitute for one.
--
--  A SIGNED CONTRACT IS NOT EDITABLE, AND THAT IS THE POINT OF THIS MIGRATION.
--
--  Once a contract is signed, its commercial terms -- value, type, dates -- are
--  what both sides agreed. Letting somebody edit the number afterwards means
--  the record no longer says what was agreed; it says what somebody last typed.
--  A trigger refuses those edits, and `contract_amendments` is the honest way
--  to change them: the previous value is written down, the new one replaces it,
--  and both are visible forever.
--
--  This is not bureaucracy for its own sake. "What did we agree, and when did
--  it change" is the question every commercial dispute turns on, and a system
--  that cannot answer it is worse than a filing cabinet.
--
--  MILESTONE TOTALS ARE NOT FORCED TO MATCH THE CONTRACT VALUE. A contract
--  worth 50,000 with 30,000 of milestones on it is usually a contract somebody
--  has not finished breaking down -- occasionally it is a retainer where the
--  milestones are only the variable part. The view reports the gap; nothing
--  refuses it. Same reasoning as over-allocation in 088 and over-assigned seats
--  in 090: a tool that cannot describe reality gets worked around.
--
--  NO VALUE IS INVENTED. `value` and every milestone `amount` are nullable with
--  no default. A contracts screen full of confident zeroes reads as "we agreed
--  to work for nothing".
--
--  RUN AFTER 091.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - contracts
-- ---------------------------------------------------------------------

create table if not exists public.contracts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,

  client_id         uuid references public.clients(id) on delete set null,
  -- Nullable: a contract is often signed before the project exists, and an
  -- umbrella agreement covers several. The project is a convenience, not the
  -- contract's identity.
  project_id        uuid references public.projects(id) on delete set null,

  reference         text not null,
  title             text not null,

  contract_type     text not null default 'fixed_price'
                      check (contract_type in ('fixed_price','time_and_materials','retainer')),

  -- Nullable, no default. See the header.
  value             numeric(14,2) check (value is null or value >= 0),
  currency          text not null default 'USD',

  start_date        date,
  end_date          date,

  status            text not null default 'draft'
                      check (status in ('draft','sent','signed','active','completed','terminated')),

  signed_at         timestamptz,
  -- Who put their name to it on the client's side. Free text on purpose: the
  -- signatory is frequently not a user of this product and never will be.
  signed_by_name    text,

  document_url      text,
  notes             text,

  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint contracts_reference_unique unique (organization_id, reference),
  constraint contracts_dates check (end_date is null or start_date is null or end_date >= start_date),

  -- A contract cannot be signed without saying when. Every status past 'sent'
  -- is a claim that somebody agreed, and a claim with no date behind it is the
  -- thing a dispute exposes.
  constraint contracts_signed_has_date check (
    status in ('draft','sent') or signed_at is not null
  )
);

create index if not exists contracts_org_status_idx on public.contracts(organization_id, status);
create index if not exists contracts_client_idx     on public.contracts(client_id);
create index if not exists contracts_project_idx    on public.contracts(project_id);


-- ---------------------------------------------------------------------
--  PART 2 - milestones
-- ---------------------------------------------------------------------
--  `invoice_id` is the join back to 079. One milestone is billed at most once,
--  which the single column enforces by existing; one invoice may cover several
--  milestones, which is why the link is on this side.

create table if not exists public.contract_milestones (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contract_id      uuid not null references public.contracts(id) on delete cascade,

  title            text not null,
  description      text,
  due_date         date,

  amount           numeric(14,2) check (amount is null or amount >= 0),

  status           text not null default 'pending'
                     check (status in ('pending','delivered','approved','invoiced')),

  -- ON DELETE SET NULL, not cascade: deleting an invoice must not delete the
  -- milestone it billed. The milestone is a thing that was agreed; the invoice
  -- is a thing that was sent.
  invoice_id       uuid references public.invoices(id) on delete set null,

  delivered_at     timestamptz,
  approved_at      timestamptz,

  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A milestone marked invoiced with no invoice on it is a claim nobody can
  -- check, and it is how a milestone quietly stops being billable.
  constraint milestone_invoiced_has_invoice check (
    status <> 'invoiced' or invoice_id is not null
  )
);

create index if not exists milestones_contract_idx on public.contract_milestones(contract_id, status);
create index if not exists milestones_invoice_idx  on public.contract_milestones(invoice_id);


-- ---------------------------------------------------------------------
--  PART 3 - amendments
-- ---------------------------------------------------------------------
--  The record of every change to a signed contract's terms. Append-only in the
--  policies below: an amendment log that can be edited answers nothing.
--
--  Both values are stored as text rather than typed columns, because an
--  amendment might change a number, a date or a type, and three nullable
--  typed pairs would be three ways to write the same row.

create table if not exists public.contract_amendments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contract_id      uuid not null references public.contracts(id) on delete cascade,

  field            text not null
                     check (field in ('value','contract_type','start_date','end_date','status')),
  previous_value   text,
  new_value        text,

  reason           text,

  amended_by       uuid,
  created_at       timestamptz not null default now()
);

create index if not exists amendments_contract_idx
  on public.contract_amendments(contract_id, created_at desc);


-- ---------------------------------------------------------------------
--  PART 4 - a signed contract's terms are frozen
-- ---------------------------------------------------------------------
--  The rule this migration exists for, and a trigger rather than a route check
--  because `contracts` is reachable from the browser through PostgREST like
--  every other table in this product.
--
--  WHAT IS STILL ALLOWED once signed: status transitions (a contract has to be
--  able to become active, completed or terminated), notes, the document link,
--  and the signatory's name. What is refused is `value`, `contract_type`,
--  `start_date` and `end_date` -- the terms.
--
--  HOW TO CHANGE THEM ANYWAY: write a `contract_amendments` row in the same
--  transaction. The trigger looks for one, so an amendment is not a formality
--  somebody can skip -- it is the mechanism.

create or replace function public.contract_terms_frozen()
returns trigger
language plpgsql
as $$
declare
  v_changed text[] := array[]::text[];
  f text;
begin
  if old.status in ('draft','sent') then
    return new;
  end if;

  if new.value          is distinct from old.value          then v_changed := v_changed || 'value'; end if;
  if new.contract_type  is distinct from old.contract_type  then v_changed := v_changed || 'contract_type'; end if;
  if new.start_date     is distinct from old.start_date     then v_changed := v_changed || 'start_date'; end if;
  if new.end_date       is distinct from old.end_date       then v_changed := v_changed || 'end_date'; end if;

  if array_length(v_changed, 1) is null then
    return new;
  end if;

  foreach f in array v_changed loop
    if not exists (
      select 1
        from public.contract_amendments a
       where a.contract_id = new.id
         and a.field       = f
         -- Written in this transaction, or within a few seconds of it. A stale
         -- amendment from last year must not authorise today's silent edit.
         and a.created_at >= now() - interval '10 seconds'
    ) then
      raise exception
        'This contract is signed. Changing % needs an amendment recording what it was.', f
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_contract_terms_frozen on public.contracts;
create trigger trg_contract_terms_frozen
  before update on public.contracts
  for each row execute function public.contract_terms_frozen();


-- ---------------------------------------------------------------------
--  PART 5 - contract health
-- ---------------------------------------------------------------------
--  `milestone_gap` is the number this view exists for: contract value less the
--  milestones broken out of it. Usually it means somebody has not finished the
--  breakdown. NULL when the value is unknown, because a gap from an unknown
--  total is not zero.

create or replace view public.contract_summary_v
  with (security_invoker = true) as
select
  c.organization_id,
  c.id                                                        as contract_id,
  c.reference,
  c.title,
  c.status,
  c.contract_type,
  c.value,
  c.currency,
  c.client_id,
  c.project_id,
  c.start_date,
  c.end_date,
  c.signed_at,
  count(m.id)                                                 as milestones,
  count(*) filter (where m.status = 'approved')               as milestones_approved,
  count(*) filter (where m.status = 'invoiced')               as milestones_invoiced,
  coalesce(sum(m.amount), 0)::numeric(14,2)                   as milestone_total,
  coalesce(sum(m.amount) filter (where m.status = 'invoiced'), 0)::numeric(14,2)
                                                              as invoiced_total,
  case
    when c.value is null then null
    else (c.value - coalesce(sum(m.amount), 0))::numeric(14,2)
  end                                                         as milestone_gap
from public.contracts c
left join public.contract_milestones m on m.contract_id = c.id
group by c.organization_id, c.id, c.reference, c.title, c.status, c.contract_type,
         c.value, c.currency, c.client_id, c.project_id, c.start_date, c.end_date,
         c.signed_at;


-- ---------------------------------------------------------------------
--  PART 6 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS MIRROR THE CATALOGUE and cannot import it:
--
--    contract.view      owner, admin, manager, finance
--    contract.manage    owner, admin, finance
--    contract.amend     owner, admin
--
--  A MANAGER READS AND DOES NOT WRITE. Delivering against a contract means
--  knowing what it says -- the scope, the dates, the milestones. Committing the
--  company to a number is a different act, and it belongs with the people who
--  answer for the money.
--
--  AMENDING IS NARROWER STILL. Changing the terms of something already signed
--  is the most consequential edit in this schema; owner and admin only.
--
--  A CLIENT READS THEIR OWN CONTRACT. They signed it. 014 already lets them see
--  their projects and 079 lets them see the lines of their own invoice; a
--  contract they are party to is the least surprising of the three.

alter table public.contracts           enable row level security;
alter table public.contract_milestones enable row level security;
alter table public.contract_amendments enable row level security;

drop policy if exists contracts_read on public.contracts;
create policy contracts_read on public.contracts
  for select to authenticated
  using (
    (organization_id = public.auth_org()
     and not public.auth_is_client()
     and coalesce(public.auth_role() in ('owner','admin','manager','finance'), false))
    or (public.auth_is_client()
        and project_id in (select public.auth_client_project_ids()))
  );

drop policy if exists contracts_write on public.contracts;
create policy contracts_write on public.contracts
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false)
               and public.auth_org_unlocked());

drop policy if exists milestones_read on public.contract_milestones;
create policy milestones_read on public.contract_milestones
  for select to authenticated
  using (
    exists (
      select 1 from public.contracts c
       where c.id = contract_milestones.contract_id
         and (
           (c.organization_id = public.auth_org()
            and not public.auth_is_client()
            and coalesce(public.auth_role() in ('owner','admin','manager','finance'), false))
           or (public.auth_is_client()
               and c.project_id in (select public.auth_client_project_ids()))
         )
    )
  );

drop policy if exists milestones_write on public.contract_milestones;
create policy milestones_write on public.contract_milestones
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false)
               and public.auth_org_unlocked());

--  Amendments are readable by anybody who may read the contract -- including
--  the client, who is the other party to whatever changed.
drop policy if exists amendments_read on public.contract_amendments;
create policy amendments_read on public.contract_amendments
  for select to authenticated
  using (
    exists (
      select 1 from public.contracts c
       where c.id = contract_amendments.contract_id
         and (
           (c.organization_id = public.auth_org()
            and not public.auth_is_client()
            and coalesce(public.auth_role() in ('owner','admin','manager','finance'), false))
           or (public.auth_is_client()
               and c.project_id in (select public.auth_client_project_ids()))
         )
    )
  );

--  INSERT ONLY. No update, no delete: an amendment log that can be edited
--  answers nothing at all.
drop policy if exists amendments_insert on public.contract_amendments;
create policy amendments_insert on public.contract_amendments
  for insert to authenticated
  with check (organization_id = public.auth_org()
              and not public.auth_is_client()
              and coalesce(public.auth_role() in ('owner','admin'), false)
              and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 7 - verify (read-only)
-- ---------------------------------------------------------------------
--  7a) the three tables exist with RLS on
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('contracts','contract_milestones','contract_amendments')
 order by c.relname;

--  7b) the view resolves AND reads as the caller (see 087)
select count(*) as contract_rows from public.contract_summary_v;

select coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'NOT SET') as security_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'contract_summary_v';

--  7c) no signed contract without a date, and no invoiced milestone without an
--      invoice. Expect zero rows for both -- the CHECKs make them impossible.
select id, reference, status, signed_at
  from public.contracts
 where status not in ('draft','sent') and signed_at is null;

select id, title, status, invoice_id
  from public.contract_milestones
 where status = 'invoiced' and invoice_id is null;

--  7d) contracts whose milestones do not add up to the value. NOT expected to
--      be zero -- this is the gap the feature surfaces, not an error.
select reference, value, milestone_total, milestone_gap
  from public.contract_summary_v
 where milestone_gap is not null and milestone_gap <> 0
 order by abs(milestone_gap) desc;
