-- ============================================================================
--  094 - Make a per-person override actually apply
--
--  THE GAP THIS CLOSES
--
--  069 added `user_permissions`: an organization may GRANT or DENY one named
--  permission to one named person — the contractor who may not see billing, the
--  developer trusted to review. `getAuthedOrg` loads them, `resolvePermission`
--  honours them, and every route that asks `authCan` respects them.
--
--  But a capability whose only gate is an RLS ROLE LIST cannot see them.
--  `public.auth_role() in ('owner','admin','hr')` has no idea an exception was
--  written. Ten capabilities are in that position, all of them things a
--  component does by writing straight to PostgREST:
--
--    organization.manage   member.manage    member.create     employee.onboard
--    employee.transfer     employee.activate  hierarchy.manage  team.view
--    project.create        billing.manage
--
--  So an administrator could open the Permissions screen, deny `member.manage`
--  to one person, watch it save, and that person could carry on editing
--  memberships. Nothing was exposed that the ROLE did not already allow — but
--  the product made a promise it did not keep, which is its own kind of defect.
--
--  HOW IT IS FIXED, and why this shape
--
--  `public.auth_override(key)` answers three ways: true for an explicit grant,
--  false for an explicit deny, NULL when nobody has said anything. Every policy
--  below becomes
--
--      coalesce(public.auth_override('member.manage'), <the role rule>)
--
--  which is exactly the order `resolvePermission` already uses in application
--  code: an explicit answer wins; otherwise the role decides. A deny beats the
--  role. A grant beats its absence. Nothing else changes.
--
--  WHAT THIS DELIBERATELY DOES NOT DO. It does not read `role_permissions`.
--  That table is a MIRROR — 074 and every sync since say so — and nothing has
--  ever read it at runtime. Making it load-bearing would turn a documentation
--  table into a thing an outage depends on, and would mean a missed sync
--  migration silently changes who can do what. The role half of each rule stays
--  written in the policy, exactly as it is today.
--
--  RUN AFTER 093. Additive: one function, and each policy replaced by an
--  equivalent that also consults the override. No table, column or row is
--  touched.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - the resolver
-- ---------------------------------------------------------------------
--  SECURITY DEFINER because the caller cannot read `user_permissions` directly
--  — and should not be able to; 069's own policies keep that screen to the
--  people who may grant. The function returns one boolean about the CALLER and
--  nothing else, so it leaks nothing a caller does not already know about
--  themselves.
--
--  `search_path` pinned for the usual reason: a SECURITY DEFINER function that
--  resolves names through the caller's search_path can be pointed at a table
--  they control.
--
--  STABLE, not IMMUTABLE: it reads tables. Postgres may cache it within one
--  statement, which is what makes it cheap enough to sit in a policy.

create or replace function public.auth_override(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select up.allowed
    from public.user_permissions up
    join public.memberships m on m.id = up.membership_id
   where m.user_id         = public.auth_app_user_id()
     and m.organization_id = public.auth_org()
     and up.permission_key = p_key
   limit 1;
$$;

revoke all on function public.auth_override(text) from public;
grant execute on function public.auth_override(text) to authenticated;


-- ---------------------------------------------------------------------
--  PART 2 - the rewrites
-- ---------------------------------------------------------------------
--  ONE RULE, APPLIED MECHANICALLY. Every policy below is its existing
--  definition with exactly one substitution:
--
--      public.auth_role() in (...)
--   -> coalesce(public.auth_override('<key>'), coalesce(public.auth_role() in (...), false))
--
--  Nothing else moves. That matters more than it sounds: the first draft of
--  this migration rewrote the policies from memory and quietly dropped two
--  clauses — `role <> 'owner'` from the membership INSERT, which would have let
--  an hr create an owner, and `role <> 'owner'` from the DELETE, which would
--  have let an admin delete one. Both are below, untouched, because they are
--  read off the originals rather than recalled.
--
--  THE OWNER CLAUSES SIT OUTSIDE THE COALESCE, deliberately. An override may
--  widen or narrow who administers members; it is not a way to make somebody an
--  owner or to remove one.

-- ── organizations : organization.manage ───────────────────────────────────
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using       (id = public.auth_org()
               and coalesce(public.auth_override('organization.manage'),
                            coalesce(public.auth_role() in ('owner','admin'), false)))
  with check  (id = public.auth_org());

-- ── memberships : member.create / member.manage / member.delete ───────────
--  hierarchy.manage rides on the UPDATE rule: `reports_to` is a column here.
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (organization_id = public.auth_org()
              and coalesce(public.auth_override('member.create'),
                           coalesce(public.auth_role() in ('owner','admin','hr'), false))
              -- KEPT VERBATIM: only an owner may create an owner.
              and (role <> 'owner' or public.auth_role() = 'owner'));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update to authenticated
  using       (organization_id = public.auth_org()
               and coalesce(public.auth_override('member.manage'),
                            coalesce(public.auth_role() in ('owner','admin','hr'), false)))
  -- KEPT VERBATIM.
  with check  (organization_id = public.auth_org()
               and (role <> 'owner' or public.auth_role() = 'owner'));

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (organization_id = public.auth_org()
         and coalesce(public.auth_override('member.delete'),
                      coalesce(public.auth_role() in ('owner','admin'), false))
         -- KEPT VERBATIM: an owner is not deletable through this policy.
         and role <> 'owner');

-- ── employee_profiles : employee.onboard / transfer / activate / manage ───
--  Two keys share the UPDATE rule because they are two names for editing the
--  same row — a transfer changes `team_id`, an activation changes
--  `employment_status`, and RLS cannot tell which column somebody meant.
--
--  A CASE, NOT NESTED COALESCE, and the difference is the whole point. Nested
--  coalesce lets the OUTER key's grant beat the inner key's deny: activate=true
--  with transfer=false came out TRUE, so an exception written to stop somebody
--  transferring people could be side-stepped by also granting them activate.
--  The draft did exactly that while its comment claimed the opposite.
--
--  This is `resolvePermission`'s own order, which the application has used
--  since 069: explicit DENY first, then explicit ALLOW, then the role. Any deny
--  wins.
drop policy if exists employee_profiles_write on public.employee_profiles;
create policy employee_profiles_write on public.employee_profiles
  for insert to authenticated
  with check (organization_id = public.auth_org()
              and coalesce(public.auth_override('employee.onboard'),
                           coalesce(public.auth_role() in ('owner','admin','hr'), false)));

drop policy if exists employee_profiles_update on public.employee_profiles;
create policy employee_profiles_update on public.employee_profiles
  for update to authenticated
  using       (organization_id = public.auth_org()
               and case
                     when public.auth_override('employee.activate') = false then false
                     when public.auth_override('employee.transfer') = false then false
                     when public.auth_override('employee.activate') = true  then true
                     when public.auth_override('employee.transfer') = true  then true
                     else coalesce(public.auth_role() in ('owner','admin','hr'), false)
                   end)
  with check  (organization_id = public.auth_org());

drop policy if exists employee_profiles_delete on public.employee_profiles;
create policy employee_profiles_delete on public.employee_profiles
  for delete to authenticated
  using (organization_id = public.auth_org()
         and coalesce(public.auth_override('employee.manage'),
                      coalesce(public.auth_role() in ('owner','admin','hr'), false)));


-- ---------------------------------------------------------------------
--  PART 5 - verify (read-only)
-- ---------------------------------------------------------------------
--  5a) the function exists and is SECURITY DEFINER with a pinned search_path
select p.proname,
       p.prosecdef                                   as security_definer,
       array_to_string(p.proconfig, ', ')            as config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'auth_override';

--  5b) every policy rewritten above now mentions the override
select tablename, policyname,
       (qual like '%auth_override%' or with_check like '%auth_override%') as consults_override
  from pg_policies
 where schemaname = 'public'
   and policyname in ('organizations_update','memberships_insert','memberships_update',
                      'memberships_delete','employee_profiles_write',
                      'employee_profiles_update','employee_profiles_delete')
 order by tablename, policyname;

--  5c) the owner clause survived. Expect TRUE — an override must not be a way
--      to make somebody an owner.
select policyname,
       with_check like '%role <> ''owner''%' as owner_clause_intact
  from pg_policies
 where schemaname = 'public' and policyname = 'memberships_update';

--  5d) how many overrides exist at all, so a "nothing changed" result is
--      distinguishable from "nothing to change".
select count(*) as overrides_written,
       count(*) filter (where allowed) as grants,
       count(*) filter (where not allowed) as denies
  from public.user_permissions;
