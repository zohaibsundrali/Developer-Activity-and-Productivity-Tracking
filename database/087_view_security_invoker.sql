-- ============================================================================
--  087 - SECURITY FIX: the six views were bypassing RLS
--
--  WHAT IS WRONG
--
--  A Postgres view executes with the privileges of its OWNER, not of the caller,
--  unless it is created `with (security_invoker = true)`. These migrations
--  created six views and not one of them said so:
--
--    075  leave_balances_v
--    079  billable_hours_v, project_pnl_v
--    081  test_run_summary_v
--    083  review_cycle_summary_v
--    085  job_opening_pipeline_v
--
--  The migration runner owns them, so every one of them reads its base tables
--  as the owner -- and the owner is not subject to row level security. Supabase
--  exposes views in `public` through PostgREST and its default privileges grant
--  SELECT on new objects in `public` to `anon` and `authenticated`. So the
--  browser's own anon-key client could select straight from these views and
--  every policy written to protect the tables underneath would be skipped.
--
--  WHAT THAT ACTUALLY LEAKED, worst first:
--
--    project_pnl_v          per-project COST. Cost is hours x
--                           employee_profiles.cost_rate, which is what people
--                           are paid. `pnl.view` was deliberately withheld from
--                           manager for exactly this reason, and the view handed
--                           it to everybody.
--    review_cycle_summary_v average performance ratings per cycle.
--    billable_hours_v       every person's approved hours and billing rate.
--    job_opening_pipeline_v candidate counts per opening, including the hiring
--                           manager's id.
--    leave_balances_v       who has taken how much leave.
--    test_run_summary_v     the least sensitive of the six, and still not
--                           something a client should be able to read.
--
--  Every one of those has a carefully written RLS policy on its base tables.
--  None of it applied through the view. The routes were never the problem --
--  they use the service role and gate on a permission key first -- which is
--  exactly why this was invisible: the application behaved correctly while the
--  database was open underneath it.
--
--  THE FIX, and why it is one line per view. `security_invoker = true` makes
--  the view run as the CALLER, so the base tables' policies apply exactly as
--  they were written. Nothing else changes: the same rows come back for anybody
--  who was entitled to them, and nothing comes back for anybody who was not.
--
--  Requires PostgreSQL 15 or later, which is where `security_invoker` was
--  added. Supabase has been on 15+ since 2023. PART 3 checks it, and if these
--  ALTERs fail with "unrecognized parameter", the database is older than that
--  and the views must be dropped instead until it is upgraded -- say so rather
--  than leaving them readable.
--
--  RUN THIS AS SOON AS THE MIGRATION THAT CREATES EACH VIEW HAS RUN. It is
--  written to survive the views not existing yet, so it is safe to run at any
--  point in the sequence and safe to run again afterwards.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - flip every view to the caller's privileges
-- ---------------------------------------------------------------------
--  Guarded on existence so this can run before, between or after the
--  migrations that create them. `to_regclass` returns null rather than raising
--  when the view is not there yet.

do $$
declare
  v text;
  views text[] := array[
    'public.leave_balances_v',
    'public.billable_hours_v',
    'public.project_pnl_v',
    'public.test_run_summary_v',
    'public.review_cycle_summary_v',
    'public.job_opening_pipeline_v'
  ];
begin
  foreach v in array views loop
    if to_regclass(v) is not null then
      execute format('alter view %s set (security_invoker = true)', v);
      raise notice 'security_invoker set on %', v;
    else
      raise notice 'skipped % - not created yet', v;
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------
--  PART 2 - verify (read-only)
-- ---------------------------------------------------------------------
--  Every view that exists must now report security_invoker=true. A view listed
--  here with `false` or a null reloptions is still bypassing RLS.

select c.relname                                             as view_name,
       coalesce(
         (select option_value
            from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'),
         'NOT SET'
       )                                                     as security_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'v'
   and c.relname in ('leave_balances_v','billable_hours_v','project_pnl_v',
                     'test_run_summary_v','review_cycle_summary_v',
                     'job_opening_pipeline_v')
 order by c.relname;


-- ---------------------------------------------------------------------
--  PART 3 - the version this depends on (read-only)
-- ---------------------------------------------------------------------
--  `security_invoker` needs PostgreSQL 15+. If PART 1 raised "unrecognized
--  parameter", this is why, and the views must be dropped rather than left
--  readable until the database is upgraded.

select current_setting('server_version') as postgres_version,
       (current_setting('server_version_num')::int >= 150000) as supports_security_invoker;


-- ---------------------------------------------------------------------
--  PART 4 - who can select these views (read-only)
-- ---------------------------------------------------------------------
--  Belt and braces. Even with security_invoker set, it is worth SEEING which
--  roles hold SELECT here rather than assuming Supabase's defaults. `anon`
--  appearing on any of these is worth a second look -- an unauthenticated
--  caller has no organization, so RLS should return nothing, but a view
--  granted to `anon` is a wider door than anything in this product needs.

select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('leave_balances_v','billable_hours_v','project_pnl_v',
                      'test_run_summary_v','review_cycle_summary_v',
                      'job_opening_pipeline_v')
   and grantee in ('anon','authenticated','public')
 order by table_name, grantee, privilege_type;
