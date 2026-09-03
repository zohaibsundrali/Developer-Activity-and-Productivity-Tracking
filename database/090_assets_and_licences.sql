-- ============================================================================
--  090 - Assets and software licences
--
--  WHAT WAS MISSING
--
--  `employee.onboard` and `employee.activate` have existed since 058, and
--  offboarding somebody has never had anything to hand back. A laptop, a phone,
--  a Figma seat: the product could hire a person, review them, pay them and
--  release them, and at no point could it say what they were holding.
--
--  TWO TABLES BECAUSE THEY ARE TWO DIFFERENT SHAPES OF THING, and folding them
--  together is the mistake this migration exists to avoid:
--
--    an ASSET is ONE physical object with ONE holder. A laptop is either on
--    somebody's desk or in the cupboard. Its history is a chain of custody.
--
--    a LICENCE is a POOL OF SEATS. Twelve Figma seats are not twelve objects;
--    they are one contract with a number on it, and what matters is how many
--    are taken and when the contract renews.
--
--  Modelling seats as assets would mean twelve rows that must be kept in step
--  with a number nobody edits in one place. Modelling an asset as a one-seat
--  licence would lose the serial number and the chain of custody. They share a
--  screen; they do not share a table.
--
--  OVER-ASSIGNMENT IS RECORDED, NOT REFUSED, and this one is worth arguing
--  about because the opposite is defensible. Using thirteen of twelve seats is
--  a contract breach, so blocking it is tempting. But a tool that cannot
--  describe reality gets worked around: the thirteenth seat still exists, it
--  just stops being written down, and then nobody can see the breach at all.
--  The view reports `over_by` and the screen shows it in red. Recording the
--  truth beats enforcing a rule the world has already broken.
--
--  NO COST IS INVENTED. `purchase_cost` and `annual_cost` are nullable with no
--  default. An asset register full of confident zeroes reads as "we own
--  nothing valuable", which is worse than an empty column that asks.
--
--  RUN AFTER 089.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - assets
-- ---------------------------------------------------------------------

create table if not exists public.assets (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,

  -- The label physically stuck on the thing. Unique per organization so two
  -- people cannot both call something ASSET-014.
  asset_tag         text not null,
  name              text not null,

  category          text not null default 'other'
                      check (category in ('laptop','desktop','monitor','phone','tablet',
                                          'peripheral','furniture','other')),

  serial_number     text,
  purchase_date     date,
  -- Nullable, no default. See the header.
  purchase_cost     numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),

  status            text not null default 'in_stock'
                      check (status in ('in_stock','assigned','repair','retired','lost')),

  -- Loose uuid, not a foreign key: a person lives in admin_users OR developers
  -- depending on user_type, and one column cannot reference two tables.
  assigned_user_id  uuid,
  assigned_at       timestamptz,

  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint assets_tag_unique unique (organization_id, asset_tag),

  -- STATUS AND HOLDER MUST AGREE. Without this the register can say "assigned"
  -- with nobody holding it, or name a holder for something sitting in the
  -- cupboard — and either way the answer to "who has the laptop" is a guess.
  constraint assets_holder_matches_status check (
    (status = 'assigned' and assigned_user_id is not null)
    or (status <> 'assigned' and assigned_user_id is null)
  )
);

create index if not exists assets_org_status_idx on public.assets(organization_id, status);
create index if not exists assets_holder_idx     on public.assets(assigned_user_id);


-- ---------------------------------------------------------------------
--  PART 2 - the chain of custody
-- ---------------------------------------------------------------------
--  Append-only, like candidate_events in 085 and for the same reason: a log
--  that can be edited is not a log. "Who had this in March" is the question an
--  asset register is actually asked, and a current-holder column alone can
--  never answer it.

create table if not exists public.asset_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  asset_id         uuid not null references public.assets(id) on delete cascade,

  from_status      text,
  to_status        text,
  from_user_id     uuid,
  to_user_id       uuid,
  note             text,

  actor_user_id    uuid,
  created_at       timestamptz not null default now()
);

create index if not exists asset_events_asset_idx on public.asset_events(asset_id, created_at desc);


-- ---------------------------------------------------------------------
--  PART 3 - software licences
-- ---------------------------------------------------------------------

create table if not exists public.software_licences (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,

  name              text not null,
  vendor            text,

  seats_total       integer check (seats_total is null or seats_total >= 0),

  -- Nullable, no default. See the header.
  annual_cost       numeric(12,2) check (annual_cost is null or annual_cost >= 0),
  renewal_date      date,

  notes             text,
  active            boolean not null default true,

  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint licences_name_unique unique (organization_id, name)
);

create index if not exists licences_org_idx on public.software_licences(organization_id, active);


-- ---------------------------------------------------------------------
--  PART 4 - licence seats
-- ---------------------------------------------------------------------
--  A seat is HELD until it is RELEASED. `released_at` rather than deletion, so
--  "who had a seat when we were billed for fourteen" stays answerable.
--
--  The partial unique index is what stops one person holding two seats on the
--  same licence: only rows that are still held take part, so somebody who is
--  given a seat, loses it and is given it back has three rows and one
--  constraint violation between them, which is none.

create table if not exists public.licence_seats (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  licence_id       uuid not null references public.software_licences(id) on delete cascade,

  user_id          uuid not null,

  assigned_at      timestamptz not null default now(),
  released_at      timestamptz,

  assigned_by      uuid,
  created_at       timestamptz not null default now()
);

create unique index if not exists licence_seats_one_active_per_person
  on public.licence_seats(licence_id, user_id)
  where released_at is null;

create index if not exists licence_seats_licence_idx on public.licence_seats(licence_id)
  where released_at is null;


-- ---------------------------------------------------------------------
--  PART 5 - keep the holder and the status in step
-- ---------------------------------------------------------------------
--  The CHECK in PART 1 refuses a contradictory row. This trigger stops the two
--  most common ways of writing one by accident, from a browser that writes this
--  table directly through PostgREST:
--
--    setting assigned_user_id without moving the status to 'assigned'
--    clearing the holder without moving the status off 'assigned'
--
--  It does not decide anything the CHECK does not; it makes the obvious
--  intention work instead of raising, so the register is easy to keep true.

create or replace function public.asset_status_follows_holder()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_user_id is not null and new.status = 'in_stock' then
    new.status := 'assigned';
  end if;

  if new.assigned_user_id is null and new.status = 'assigned' then
    new.status := 'in_stock';
  end if;

  -- A thing that is not with somebody cannot have a holder, whatever the caller
  -- meant by 'repair' or 'retired'.
  if new.status <> 'assigned' then
    new.assigned_user_id := null;
    new.assigned_at := null;
  elsif new.assigned_at is null then
    new.assigned_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_asset_status_follows_holder on public.assets;
create trigger trg_asset_status_follows_holder
  before insert or update on public.assets
  for each row execute function public.asset_status_follows_holder();


-- ---------------------------------------------------------------------
--  PART 6 - licence usage
-- ---------------------------------------------------------------------
--  `over_by` is the point of this view. See the header: over-assignment is
--  recorded rather than refused, so something has to show it.
--
--  `seats_free` is NULL when `seats_total` is NULL — an unknown contract size
--  has no free count, and 0 would read as "fully used".

create or replace view public.licence_usage_v
  with (security_invoker = true) as
select
  l.organization_id,
  l.id                                          as licence_id,
  l.name,
  l.vendor,
  l.seats_total,
  l.annual_cost,
  l.renewal_date,
  l.active,
  count(s.id)                                   as seats_used,
  case
    when l.seats_total is null then null
    else greatest(0, l.seats_total - count(s.id))
  end                                           as seats_free,
  case
    when l.seats_total is null then null
    else greatest(0, count(s.id) - l.seats_total)
  end                                           as over_by
from public.software_licences l
left join public.licence_seats s
  on  s.licence_id  = l.id
  and s.released_at is null
group by l.organization_id, l.id, l.name, l.vendor, l.seats_total,
         l.annual_cost, l.renewal_date, l.active;


-- ---------------------------------------------------------------------
--  PART 7 - what one person is holding
-- ---------------------------------------------------------------------
--  The offboarding question, answered in one place rather than by opening two
--  screens and remembering to check both.

create or replace view public.person_holdings_v
  with (security_invoker = true) as
select
  a.organization_id,
  a.assigned_user_id                            as user_id,
  'asset'::text                                 as kind,
  a.id                                          as item_id,
  a.name,
  a.asset_tag                                   as reference,
  a.assigned_at                                 as since
from public.assets a
where a.assigned_user_id is not null
  and a.status = 'assigned'
union all
select
  s.organization_id,
  s.user_id,
  'licence'::text,
  l.id,
  l.name,
  l.vendor,
  s.assigned_at
from public.licence_seats s
join public.software_licences l on l.id = s.licence_id
where s.released_at is null;


-- ---------------------------------------------------------------------
--  PART 8 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS MIRROR THE CATALOGUE and cannot import it:
--
--    asset.view / licence.view    owner, admin, hr, finance
--    asset.manage                 owner, admin, hr
--    licence.manage               owner, admin, finance
--
--  WHY THE TWO MANAGE KEYS DIFFER. Handing somebody a laptop is part of
--  onboarding and offboarding, which is HR's process. Buying seats is recurring
--  spend against a renewal date, which is finance's. Both are owner and admin
--  as well, and neither is a manager: an asset register that a project manager
--  can edit stops being a register of what the company owns.
--
--  EVERYBODY SEES WHAT THEY THEMSELVES HOLD. Not a permission -- a fact about
--  the row, like the hiring manager in 085. "What am I signed out?" is not a
--  question anybody should need a key to ask about themselves.

alter table public.assets            enable row level security;
alter table public.asset_events      enable row level security;
alter table public.software_licences enable row level security;
alter table public.licence_seats     enable row level security;

drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      coalesce(public.auth_role() in ('owner','admin','hr','finance'), false)
      or assigned_user_id = public.auth_app_user_id()
    )
  );

drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','hr'), false)
               and public.auth_org_unlocked());

drop policy if exists asset_events_read on public.asset_events;
create policy asset_events_read on public.asset_events
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_role() in ('owner','admin','hr','finance'), false));

drop policy if exists asset_events_insert on public.asset_events;
create policy asset_events_insert on public.asset_events
  for insert to authenticated
  with check (organization_id = public.auth_org()
              and not public.auth_is_client()
              and coalesce(public.auth_role() in ('owner','admin','hr'), false)
              and public.auth_org_unlocked());

drop policy if exists licences_read on public.software_licences;
create policy licences_read on public.software_licences
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_role() in ('owner','admin','hr','finance'), false));

drop policy if exists licences_write on public.software_licences;
create policy licences_write on public.software_licences
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false)
               and public.auth_org_unlocked());

drop policy if exists licence_seats_read on public.licence_seats;
create policy licence_seats_read on public.licence_seats
  for select to authenticated
  using (
    organization_id = public.auth_org()
    and not public.auth_is_client()
    and (
      coalesce(public.auth_role() in ('owner','admin','hr','finance'), false)
      or user_id = public.auth_app_user_id()
    )
  );

drop policy if exists licence_seats_write on public.licence_seats;
create policy licence_seats_write on public.licence_seats
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','finance'), false)
               and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 9 - verify (read-only)
-- ---------------------------------------------------------------------
--  9a) the four tables exist with RLS on
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('assets','asset_events','software_licences','licence_seats')
 order by c.relname;

--  9b) both views resolve AND read as the caller (see 087)
select count(*) as licence_rows  from public.licence_usage_v;
select count(*) as holding_rows  from public.person_holdings_v;

select c.relname,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'NOT SET') as security_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('licence_usage_v','person_holdings_v')
 order by c.relname;

--  9c) no asset contradicts itself. Expect zero rows -- the CHECK and the
--      trigger make it impossible, so this is a check on them.
select id, asset_tag, status, assigned_user_id
  from public.assets
 where (status = 'assigned') <> (assigned_user_id is not null);

--  9d) licences in breach of their own seat count. NOT expected to be zero --
--      this is the number the feature exists to surface.
select name, seats_total, seats_used, over_by
  from public.licence_usage_v
 where coalesce(over_by, 0) > 0
 order by over_by desc;
