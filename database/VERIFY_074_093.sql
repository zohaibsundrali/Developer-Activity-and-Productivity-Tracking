-- ============================================================================
--  VERIFY 074-093 — one query, run after the migrations
--
--  WHY THIS EXISTS. Twenty migrations were added between 074 and 093 and each
--  ends with its own read-only verify block. Running all twenty and reading
--  twenty outputs is a lot to ask, and the useful signal is small: did the
--  tables land, did the views land READING AS THE CALLER, and does the
--  permission mirror match the catalogue.
--
--  This is read-only. It creates nothing, changes nothing, and is safe to run
--  as many times as you like.
--
--  WHAT TO LOOK FOR, in order of how much it matters:
--
--    1. Section 2 — every view must say security_invoker = true. A view saying
--       NOT SET reads its base tables as the OWNER and skips every RLS policy
--       underneath it. `project_pnl_v` in that state exposes per-project cost,
--       which is derived from what people are paid. That is what migration 087
--       exists to fix; if any row here is not `true`, 087 has not run or did
--       not take.
--
--    2. Section 1 — a table with rls_enabled = false is readable by anybody
--       with a login, whatever its policies say.
--
--    3. Section 3 — the mirror should be 452 rows over 102 keys. A smaller
--       number means one of the re-sync migrations (074, 076, 078, 080, 082,
--       084, 086, 089, 091, 093) has not run. Nothing reads this table at
--       runtime, so a mismatch is not an outage — it means the Permissions
--       screen is showing a stale model.
--
--    4. Section 4 — who can SELECT the views. `anon` on any row is worth a
--       second look: an unauthenticated caller has no organization, so RLS
--       should return nothing, but it is a wider door than anything here needs.
-- ============================================================================


-- ONE STATEMENT, so a single run gives a single result you can paste back.
-- Four sections, UNION ALL'd, every column text so they line up.

-- ── 1. Every table these migrations added, and whether RLS is on ───────────
select
  '1. tables'            as section,
  c.relname              as name,
  c.relrowsecurity::text as detail,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)::text as extra
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'attendance_records','leave_types','leave_requests',            -- 075
    'timesheets',                                                   -- 077
    'invoice_lines',                                                -- 079
    'test_cases','test_runs','test_executions',                     -- 081
    'review_cycles','performance_reviews','performance_goals',      -- 083
    'job_openings','candidates','candidate_events',                 -- 085
    'assets','asset_events','software_licences','licence_seats',    -- 090
    'contracts','contract_milestones','contract_amendments'         -- 092
  )

union all

-- ── 2. THE ONE THAT MATTERS MOST: every view reads as the CALLER ───────────
--  Anything but `true` means that view is bypassing RLS. See 087.
select
  '2. views',
  c.relname,
  coalesce(
    (select option_value from pg_options_to_table(c.reloptions)
      where option_name = 'security_invoker'),
    'NOT SET  <-- BYPASSING RLS'
  ),
  ''
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in (
    'leave_balances_v','billable_hours_v','project_pnl_v','test_run_summary_v',
    'review_cycle_summary_v','job_opening_pipeline_v','capacity_week_v',
    'licence_usage_v','person_holdings_v','contract_summary_v'
  )

union all

-- ── 3. The permission mirror. Expect 452 rows over 102 keys ────────────────
select
  '3. mirror',
  'role_permissions',
  count(*)::text || ' rows',
  count(distinct (resource || '.' || action))::text || ' keys'
from public.role_permissions
where allowed

union all

-- ── 4. Who may SELECT those views ──────────────────────────────────────────
select
  '4. grants',
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated')
  and privilege_type = 'SELECT'
  and table_name in (
    'leave_balances_v','billable_hours_v','project_pnl_v','test_run_summary_v',
    'review_cycle_summary_v','job_opening_pipeline_v','capacity_week_v',
    'licence_usage_v','person_holdings_v','contract_summary_v'
  )

order by 1, 2, 3;
