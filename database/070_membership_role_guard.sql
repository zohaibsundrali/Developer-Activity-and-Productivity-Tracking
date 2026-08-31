-- ============================================================================
--  070 - The membership row cannot promote its own owner
--
--  WHAT WAS WRONG
--
--  `auth_role()` reads app_metadata.role out of the caller's JWT, and every RLS
--  policy in this database is built on it. /api/auth/repair-claims copies
--  `memberships.role` INTO that claim. So whoever can write a membership row
--  decides, one refresh later, what the token says about them.
--
--  018's `memberships_update` lets owner, admin AND hr update any membership
--  row in their organization. Its WITH CHECK blocks exactly one thing: setting
--  the literal role 'owner' when you are not one. Nothing else. In particular:
--
--    - no self-target rule, so a row's subject may edit their own row
--    - no rank rule, so `hr` (rank 60) may write 'admin' (rank 90)
--    - USING has no `role <> 'owner'` term, so an `admin` may edit the OWNER's
--      row and demote them
--
--  The browser holds an anon-key PostgREST client bound to the user's own JWT
--  (utils/supabaseClient.js), so this needs no tooling:
--
--    await supabase.from('memberships').update({role:'admin'}).eq('id', mine)
--    await fetch('/api/auth/repair-claims', {method:'POST', ...})
--    await supabase.auth.refreshSession()      -- now an admin
--
--  The rules that forbid this — no self-target, and no granting a role at or
--  above your own — DO exist, in api/admin/members/role/authorize.js. They are
--  enforced on a route the attack never calls. Routing role changes through
--  that screen is a convention of the UI, not a control.
--
--  WHAT THIS FILE DOES
--
--  Moves those two rules into the database, where the browser also has to obey
--  them, and takes `hr` out of the set that may change a role at all.
--
--  A TRIGGER, NOT A POLICY. A WITH CHECK sees only the NEW row. "Did the role
--  change, and was it raised" is a question about OLD versus NEW, which only a
--  row-level trigger can ask. The policy stays as it is so that hr keeps the
--  rest of its people-ops write access — name, team, department, reports_to —
--  and loses only the column that mints privilege.
--
--  SERVICE ROLE IS EXEMPT, deliberately and by the same reasoning as 048: the
--  API routes that legitimately change a role run as the service role and
--  carry authorize.js, which enforces a strictly stronger rule than this
--  trigger (it also refuses cross-tenant targets and validates the role name).
--  Exempting them here keeps one implementation of the rule instead of two
--  that will drift. What this trigger governs is the direct-PostgREST path,
--  which is the one with no guard at all today.
--
--  READ-ONLY UNTIL YOU RUN IT. Creates one function and one trigger. Touches no
--  data, drops no policy, and changes no existing row.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - role_rank: the same numbers as utils/roles.js ROLE_RANK
-- ---------------------------------------------------------------------
--  Sparse on purpose, so a role can be added between two others without
--  renumbering. developer/designer/devops deliberately TIE — they do the same
--  work with the same access, and the comparisons below use strict `<`, which
--  copes with a tie by refusing it.
--
--  An unrecognised role returns NULL, and every comparison against NULL is
--  NULL, which is not true — so an unknown role on either side of a change is
--  refused rather than admitted. utils/roles.js documents the day `atLeast()`
--  defaulted unknown roles to 99 and became fail-OPEN; this returns NULL for
--  the same reason, in the other direction.

create or replace function public.role_rank(p_role text)
returns integer language sql immutable
set search_path = public, pg_temp
as $$
  select case p_role
    when 'owner'     then 100
    when 'admin'     then 90
    when 'manager'   then 70
    when 'hr'        then 60
    when 'finance'   then 55
    when 'team_lead' then 50
    when 'qa'        then 35
    when 'developer' then 30
    when 'designer'  then 30
    when 'devops'    then 30
    when 'employee'  then 20
    when 'client'    then 10
    else null
  end
$$;


-- ---------------------------------------------------------------------
--  PART 2 - The guard
-- ---------------------------------------------------------------------
--  Order matters, and each step is a separate early return so the reason a
--  request was allowed is legible in one pass:
--
--   1. Not an UPDATE, or the role did not move -> allowed. hr keeps every
--      other column on the row.
--   2. Service role / superuser -> allowed. See the header.
--   3. Clients -> refused outright.
--   4. Only owner and admin may move a role. THIS IS WHERE hr LOSES IT.
--   5. Nobody changes their own role, not even an owner. Matched on user_id
--      against auth_app_user_id(), which is the same identity RLS uses.
--   6. Only an owner may grant or revoke 'owner'.
--   7. A non-owner may not grant a role at or above their own, nor change the
--      role of somebody already at or above them. Strict `<` on both sides, so
--      the developer/designer/devops tie is refused rather than allowed.
--
--  DO NOT ADD `security definer`. It would report current_user as the function
--  owner, every caller would look like postgres, and step 2 would admit
--  everyone while this file still looked applied. Same trap as 048.

create or replace function public.memberships_guard_role_change()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_actor_rank integer;
  v_new_rank   integer;
  v_old_rank   integer;
  v_privileged boolean := false;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- 1. The role did not move. `is distinct from` so a null on either side
  --    counts as a change rather than silently comparing as null.
  if old.role is not distinct from new.role then
    return new;
  end if;

  -- 2. Trusted server-side callers.
  if current_user in ('service_role','postgres','supabase_admin',
                      'supabase_auth_admin','supabase_storage_admin') then
    return new;
  end if;
  select coalesce(bool_or(r.rolsuper or r.rolbypassrls), false)
    into v_privileged from pg_roles r where r.rolname = current_user;
  if v_privileged then
    return new;
  end if;

  v_actor_role := public.auth_role();

  -- 3. Clients never touch staff roles.
  if public.auth_is_client() then
    raise exception using errcode = '42501',
      message = 'permission denied: clients may not change member roles';
  end if;

  -- 4. hr is removed here. It keeps the rest of the row.
  if coalesce(v_actor_role in ('owner','admin'), false) = false then
    raise exception using errcode = '42501',
      message = 'permission denied: your role may not change member roles',
      hint    = 'Role changes are made by an owner or admin from the Members screen.';
  end if;

  -- 5. No self-promotion, and no self-demotion either: a role you can lower is
  --    a role you can raise back, and the audit trail should name two people.
  if new.user_id is not distinct from public.auth_app_user_id() then
    raise exception using errcode = '42501',
      message = 'permission denied: you cannot change your own role',
      hint    = 'Ask another owner or admin.';
  end if;

  -- 6. The owner role is owner-granted only, in both directions.
  if (new.role = 'owner' or old.role = 'owner') and v_actor_role <> 'owner' then
    raise exception using errcode = '42501',
      message = 'permission denied: only an owner may grant or revoke the owner role';
  end if;

  -- 7. Rank. Owners skip it: they outrank everything, and step 6 already
  --    governs the only role that could tie with them.
  if v_actor_role <> 'owner' then
    v_actor_rank := public.role_rank(v_actor_role);
    v_new_rank   := public.role_rank(new.role);
    v_old_rank   := public.role_rank(old.role);

    -- Any NULL here is an unrecognised role. `not (null < n)` is null, which
    -- is not true, so the refusal below fires. Fail closed.
    if not (v_new_rank < v_actor_rank) then
      raise exception using errcode = '42501',
        message = format('permission denied: you cannot grant the "%s" role', new.role);
    end if;
    if not (v_old_rank < v_actor_rank) then
      raise exception using errcode = '42501',
        message = format('permission denied: you cannot change the role of a "%s"', old.role);
    end if;
  end if;

  return new;
end
$$;


-- ---------------------------------------------------------------------
--  PART 3 - Attach it
-- ---------------------------------------------------------------------
--  BEFORE UPDATE FOR EACH ROW, and no WHEN clause: the OLD/NEW comparison is
--  step 1 of the function, so a deployment where the column is missing fails
--  loudly at CREATE rather than creating a trigger that never fires.

drop trigger if exists trg_memberships_role_guard on public.memberships;
create trigger trg_memberships_role_guard
  before update on public.memberships
  for each row execute function public.memberships_guard_role_change();


-- ---------------------------------------------------------------------
--  VERIFY (read-only - safe to run before and after)
-- ---------------------------------------------------------------------
--  Expect: one row, trg_memberships_role_guard, tgenabled = 'O'.
--
--  select t.tgname, t.tgenabled
--  from pg_trigger t
--  where t.tgrelid = 'public.memberships'::regclass and not t.tgisinternal;
--
--  Expect: 100, 60, null.
--  select public.role_rank('owner'), public.role_rank('hr'), public.role_rank('nope');
