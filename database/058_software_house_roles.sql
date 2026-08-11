-- =====================================================================
--  058 - the roles a software house actually has
-- =====================================================================
--
--  Adds three roles to the eight that exist: `designer`, `qa`, `finance`.
--
--  WHY THESE THREE AND NOT MORE
--
--  A role is only worth existing if its PERMISSIONS differ. Anything else is
--  a job title, and job titles already have a home: `employee_profiles.
--  designation`, a free-text field. Inventing `sales`, `intern`, `architect`
--  or `scrum_master` as roles would add eleven ways to say "developer" and
--  eleven things to keep in sync across the policies below, the nav config,
--  the permissions module and every route that enumerates roles — for no
--  difference in what anyone can do.
--
--  So:
--
--    finance   GENUINELY different. Sees billing, invoices and clients;
--              does NOT see screenshots, keystroke counts or activity. Today
--              an accountant has to be made `admin` to read an invoice, which
--              hands them the entire monitoring surface. That is the one role
--              gap here with a real security consequence.
--
--    qa        GENUINELY different. A developer who may also REVIEW other
--              people's submissions. Today only owner/admin can review, so a
--              QA engineer cannot do the job the title describes.
--
--    designer  NOT different, and this file will not pretend otherwise. Its
--              permissions are identical to `developer` on the day it ships.
--              It exists because the owner asked for designers to be a
--              first-class role rather than a job title, and because having
--              the value in the enum is what makes it possible to diverge
--              later without a data migration. Anyone reading this later
--              should know it was a deliberate, informed choice and not an
--              oversight.
--
--  WHAT DOES NOT CHANGE
--
--  Every existing role keeps exactly the permissions it has. `designer` and
--  `qa` land outside all the elevated lists in the RLS policies, which means
--  they inherit the developer-shaped access automatically — nothing had to be
--  written for them, and that is the correct default. Only `finance` needed
--  new grants, and only on billing-facing tables.
--
--  RUN PART 1, then PART 2, then PART 3 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Widen the role CHECK constraints
-- ---------------------------------------------------------------------
--
--  Same shape as migration 015, which is what put `hr` and `team_lead` into
--  these constraints. The constraint is found by its DEFINITION rather than by
--  name, because 010 named it one thing and 015 renamed it — matching on
--  `%manager%` finds whichever is actually there.
--
--  Without this every insert of a new role fails with 23514, and that is not
--  hypothetical: probing the live database with a bogus role returned exactly
--  that before this file was written.

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
                         'qa','developer','designer','employee','client'))$f$,
      t, t || '_role_check'
    );
  end loop;
end $$;


-- ---------------------------------------------------------------------
--  PART 2 - Give `finance` the billing surface, and nothing else
-- ---------------------------------------------------------------------
--
--  Recreated with their existing rule intact and 'finance' added. Read each
--  diff as "same policy, plus finance".
--
--  finance is added ONLY here. It is deliberately absent from the monitoring
--  policies (040), the employee policies (015/018) and the project policies —
--  an accountant has no business seeing a colleague's screen captures, and
--  the entire point of the role is that they no longer have to be an admin to
--  do their job.

-- Invoices raised to clients.
--
-- ADDED as a new policy rather than by rewriting the existing staff one, and
-- the distinction matters. The two `pg_policies` dumps taken from the live
-- project showed only `invoices_client_read` on this table; whatever grants
-- STAFF access to invoices did not appear in either, so its name is unknown
-- here. Rewriting a policy whose name I would have to guess is how a table
-- ends up with the old policy still in place beside the new one — which is
-- exactly the failure 054 was written to undo.
--
-- Adding is safe in a way that rewriting is not: policies are OR'd, so a new
-- permissive policy can only ever GRANT, and this one grants nothing to anyone
-- who is not `finance`. Nobody else's access moves by a single row.
-- Dropped first only so the file is re-runnable. This name is one THIS file
-- introduced, so dropping it cannot remove somebody else's rule.
drop policy if exists invoices_finance_all on public.invoices;
create policy invoices_finance_all on public.invoices for all to authenticated
  using      (organization_id = public.auth_org() and not public.auth_is_client()
              and public.auth_role() = 'finance')
  with check (organization_id = public.auth_org() and not public.auth_is_client()
              and public.auth_role() = 'finance');

-- The organization's own subscription.
drop policy if exists org_subscriptions_read on public.organization_subscriptions;
create policy org_subscriptions_read on public.organization_subscriptions
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client()
         and public.auth_role() = any (array['owner','admin','finance']));

-- Billing invoices from us to the organization.
drop policy if exists billing_invoices_read on public.billing_invoices;
create policy billing_invoices_read on public.billing_invoices
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client()
         and public.auth_role() = any (array['owner','admin','finance']));


-- ---------------------------------------------------------------------
--  PART 3 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  3a. The constraint must now list all eleven roles. Expect three rows
--      (memberships, invitations, role_permissions), each mentioning
--      'designer', 'qa' and 'finance'.
select rel.relname as table_name,
       (pg_get_constraintdef(con.oid) like '%designer%') as has_designer,
       (pg_get_constraintdef(con.oid) like '%qa%')       as has_qa,
       (pg_get_constraintdef(con.oid) like '%finance%')  as has_finance
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and con.contype = 'c'
  and rel.relname in ('memberships','invitations','role_permissions')
  and pg_get_constraintdef(con.oid) ilike '%manager%'
order by rel.relname;

--  3b. finance reaches the three billing surfaces. Expect 3 rows.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and coalesce(qual, '') like '%finance%'
order by tablename;

--  3b-ii. Re-running this file must not stack duplicate invoice policies.
--         Expect exactly 1.
select count(*) as invoices_finance_policies
from pg_policies
where schemaname = 'public' and tablename = 'invoices'
  and policyname = 'invoices_finance_all';

--  3c. AND NOWHERE ELSE. finance must not appear on any monitoring,
--      employee or project policy. Expect 0 rows.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') like '%finance%' or coalesce(with_check, '') like '%finance%')
  and tablename not in ('invoices', 'organization_subscriptions', 'billing_invoices')
order by tablename;

--  3d. designer and qa must appear in NO policy at all — they inherit the
--      developer-shaped default by being absent from every elevated list,
--      which is the whole reason they needed no policy work. Expect 0 rows.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') ~ '\mdesigner\M' or coalesce(with_check, '') ~ '\mdesigner\M'
    or coalesce(qual, '') ~ '\mqa\M'       or coalesce(with_check, '') ~ '\mqa\M')
order by tablename;


-- =====================================================================
--  AFTER RUNNING THIS
--
--    finance   billing, invoices, subscription. No monitoring, no employees,
--              no projects.
--    qa        everything a developer has; the app layer additionally lets it
--              review submissions (src/utils/permissions.js).
--    designer  identical to developer, by design, for now.
--
--  Assign them from Organization → Members like any other role.
-- =====================================================================
