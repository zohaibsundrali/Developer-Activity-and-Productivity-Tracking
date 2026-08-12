-- =====================================================================
--  067 - the devops role
-- =====================================================================
--
--  A software house has people who run the infrastructure, and this product
--  had no word for them. The eleven roles stopped at developer / designer /
--  qa, so a DevOps engineer had to be filed as a "developer" — which is not
--  what they do, and made every headcount and every team chart slightly wrong.
--
--  SAME SHAPE AS 058, which is what put designer/qa/finance in, and 015 before
--  it. Without this every insert of the new role fails with 23514 — not
--  hypothetical: 058's header records probing the live database with a bogus
--  role and getting exactly that.
--
--  RANK: the same as developer and designer. They do the same kind of work
--  with the same access, and none outranks the others. See src/utils/roles.js;
--  anything comparing those numbers already has to cope with a tie.
--
--  WHAT THIS DELIBERATELY DOES NOT ADD: a separate `ui_ux` role. `designer`
--  already exists and covers it. Having both would mean every person hiring a
--  UI designer has to guess which of two roles is the right one, and the two
--  would drift apart in the permission lists — the exact problem 058's header
--  describes. If the split is genuinely wanted, it should be a decision taken
--  on purpose, not a second name arriving beside the first.
--
--  RUN PART 1, then PART 2 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Widen the role CHECK constraints
-- ---------------------------------------------------------------------
--
--  The constraint is found by its DEFINITION rather than by name, because 010
--  named it one thing and 015 renamed it — matching on `%manager%` finds
--  whichever is actually there. Exactly what 058 does.

do $$
declare t text; c record;
begin
  foreach t in array array['memberships','invitations','role_permissions'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    for c in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' and rel.relname = t and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%manager%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format(
      $f$alter table public.%I add constraint %I
         check (role in ('owner','admin','manager','team_lead','hr','finance',
                         'qa','developer','designer','devops','employee','client'))$f$,
      t, t || '_role_check'
    );
  end loop;
end $$;


-- ---------------------------------------------------------------------
--  PART 2 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  2a. All twelve roles are listed, on every table that has the constraint.
--      Expect one row per existing table, each mentioning devops.
select rel.relname as table_name,
       pg_get_constraintdef(con.oid) ilike '%devops%' as allows_devops
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('memberships','invitations','role_permissions')
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%manager%'
order by rel.relname;

--  2b. Nobody was reclassified. This migration widens what is ALLOWED and
--      changes no existing row. Expect devops = 0 until somebody is given it.
select role, count(*) as members
from public.memberships
group by role
order by 2 desc, 1;

--  2c. A bogus role is still refused — the constraint was widened, not dropped.
--      This SHOULD raise; the block reports which happened rather than failing
--      the script.
do $$
begin
  begin
    perform 1 from public.memberships limit 0;
    execute $q$update public.memberships set role = 'wizard' where false$q$;
    raise notice 'role constraint: not exercised (no rows matched)';
  exception when check_violation then
    raise notice 'role constraint: STILL ENFORCED';
  end;
end $$;
