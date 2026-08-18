-- ============================================================================
--  069 — per-person permission overrides
-- ============================================================================
--
--  WHAT THIS ADDS AND WHY
--
--  `role_permissions` (repaired in 068) says what a ROLE may do. Every real
--  organization has exceptions to that: the contractor who may not see billing,
--  the senior developer trusted to review other people's work, the manager on
--  leave whose approvals are paused for a fortnight.
--
--  Without somewhere to put an exception, the only way to express one is a new
--  role — and that is how a twelve-role product becomes a forty-role product
--  in which no two roles differ by more than a single permission, each needing
--  its own row in every list. This table is the alternative.
--
--  ONE ROW = ONE DECISION about one permission for one membership.
--
--  KEYED BY MEMBERSHIP, NOT BY USER. The same person in two organizations is
--  two memberships, and an exception granted in one must not follow them to the
--  other. Same boundary every other table here draws.
--
--  HOW IT IS READ: src/utils/permissionOverrides.js, and the order it feeds is
--  in src/utils/permissionEngine.js — deny beats everything, then grant, then
--  project role, then org role, then refuse. A DENY outranks even an owner's
--  role grant, because the only reason to write one is to take something away
--  from somebody who would otherwise have it.
--
--  DESTRUCTIVE? No. It creates one table and its policies. It reads nothing,
--  changes nothing, and drops nothing. Before it runs, per-person overrides
--  simply do not exist and every caller resolves by role — which is exactly
--  what happens today.
--
--  HOW TO RUN IT: Supabase dashboard -> SQL Editor -> paste this whole file ->
--  Run. Then run the VERIFY block at the bottom separately.
-- ============================================================================

begin;

create table if not exists public.user_permissions (
  id             uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: an override is meaningless once the membership is gone,
  -- and leaving orphans would let a re-invited person inherit an exception
  -- somebody granted their predecessor.
  membership_id  uuid not null references public.memberships(id) on delete cascade,

  -- Deliberately TEXT and deliberately NOT a foreign key to a permissions
  -- table. The catalogue lives in application code
  -- (src/utils/permissionCatalogue.js) because a permission check must not need
  -- a round trip — the edge middleware cannot make one. A key that no longer
  -- exists in the catalogue simply never matches anything, which is the safe
  -- failure; a foreign key would instead make deleting a permission from the
  -- code a migration.
  permission_key text not null check (permission_key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),

  -- true = grant, false = deny. NOT NULL: a null here would be a third state
  -- nobody has defined, and the reader would have to guess which way it falls.
  -- Withdrawing a decision means deleting the row.
  allowed        boolean not null,

  -- Who did this and why. An exception with no author is one nobody can
  -- question later, and these are exactly the rows an auditor asks about.
  granted_by     uuid references public.memberships(id) on delete set null,
  note           text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One decision per permission per membership. Two rows disagreeing about the
  -- same key would make the answer depend on row order.
  unique (membership_id, permission_key)
);

-- The read path filters by membership; the admin screen lists by membership.
create index if not exists user_permissions_membership_idx
  on public.user_permissions (membership_id);

alter table public.user_permissions enable row level security;

-- ---------------------------------------------------------------------------
--  POLICIES
--
--  Reads: any authenticated member of the same organization. Effective
--  permissions are not a secret from the people they apply to, and the admin
--  screen needs to show them. Cross-organization reads are refused by the
--  membership join, not by trusting a caller-supplied org id.
--
--  Writes: owner only, matching the `permissions.manage` key in the catalogue.
--  Granting permissions is the sharpest tool in the product — someone who can
--  write here can grant themselves anything — so it is the one capability that
--  does not extend to admin.
-- ---------------------------------------------------------------------------
drop policy if exists user_permissions_read on public.user_permissions;
create policy user_permissions_read on public.user_permissions
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.id = user_permissions.membership_id
         and m.organization_id = public.auth_org()
    )
  );

drop policy if exists user_permissions_write on public.user_permissions;
create policy user_permissions_write on public.user_permissions
  for all to authenticated
  using (
    public.auth_role() = 'owner'
    and not public.auth_is_client()
    and exists (
      select 1 from public.memberships m
       where m.id = user_permissions.membership_id
         and m.organization_id = public.auth_org()
    )
  )
  with check (
    public.auth_role() = 'owner'
    and not public.auth_is_client()
    and exists (
      select 1 from public.memberships m
       where m.id = user_permissions.membership_id
         and m.organization_id = public.auth_org()
    )
  );

commit;

-- ============================================================================
--  VERIFY — run separately, after the transaction above has committed.
-- ============================================================================
--
--  1. The table exists and is empty. Expect 0.
--     select count(*) from public.user_permissions;
--
--  2. RLS is on. Expect rowsecurity = true.
--     select relname, relrowsecurity as rowsecurity
--       from pg_class where relname = 'user_permissions';
--
--  3. Both policies exist. Expect two rows.
--     select policyname, cmd from pg_policies
--      where tablename = 'user_permissions' order by policyname;
--
--  4. The key format check rejects nonsense. Expect an error mentioning
--     "user_permissions_permission_key_check" — if this INSERTS instead, the
--     CHECK did not take.
--     insert into public.user_permissions (membership_id, permission_key, allowed)
--     select id, 'NOT A KEY', true from public.memberships limit 1;
--
--  5. The uniqueness rule holds. Run this twice; the SECOND must fail with
--     "user_permissions_membership_id_permission_key_key". Then delete it.
--     insert into public.user_permissions (membership_id, permission_key, allowed)
--     select id, 'billing.view', false from public.memberships limit 1;
--
--     delete from public.user_permissions where permission_key = 'billing.view';
--
--  6. Nothing else was touched. Expect the same 160 rows migration 068 left.
--     select count(*) from public.role_permissions;
-- ============================================================================
