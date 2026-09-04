-- ============================================================================
--  095 - Let the people who build the thing see the tests that judge it
--
--  WHAT THIS CHANGES
--
--  081 gave all four quality keys to the same five roles and said, in the
--  migration and again in permissionCatalogue.js, that this was not the design:
--
--      "The design wants reading and EXECUTING to be wider than writing: a
--       developer should see what will be checked before calling something
--       finished, and testing is not something QA does alone."
--
--  It was deferred for a concrete reason, not a vague one. `developer`,
--  `designer` and `devops` cannot enter /admin, so `test_case.view` would have
--  been a key with no screen -- and because ADMIN_AREA_ROLES is DERIVED by
--  flattening every gated section's role list, widening the key would have
--  opened the admin front door to all three. tests/roleDashboards.test.js
--  caught that when it was tried.
--
--  The staff shell now has a Tests screen, so the widening lands here.
--
--  WHO GAINS WHAT
--
--    test_case.view    owner admin manager team_lead qa  ->  + developer,
--    test_run.execute                                          designer,
--                                                              devops,
--                                                              employee
--
--    test_case.manage  unchanged (owner admin manager team_lead qa)
--    test_run.manage   unchanged
--
--  hr and finance gain NOTHING and that is deliberate: neither has a reason to
--  read a test case, and a screen nobody opens is still a surface.
--
--  RAISING A DEFECT DID NOT COME ALONG. /api/quality?action=bug used to ask
--  `test_run.execute`, which was right while that key meant REVIEWERS. Filing a
--  defect writes a `developer_tasks` row, and creating a task is SUPERVISORS
--  everywhere else in this product, so the act now has its own key --
--  `bug.raise`, holding exactly the roles execute held yesterday. Nobody gains
--  or loses it today. See 096 and the note in permissionCatalogue.js.
--
--  EXECUTIONS ARE SPLIT, which is the substantive change in this file. 081 had
--  ONE `for all` policy on test_executions, so the role list that let somebody
--  record a result also let them insert and delete execution rows. Recording a
--  result is now UPDATE and wide; creating and deleting the run's rows stay
--  with `test_run.manage` and narrow. Without the split, widening execute would
--  have let a developer delete the evidence of a run.
--
--  Every policy here also consults `public.auth_override`, the resolver 094
--  added, so a per-person exception applies to this module the way it applies
--  to the rest.
--
--  RUN AFTER 094. Additive: policies replaced by equivalents. No table, column
--  or row is touched.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - reading: test cases, runs and executions
-- ---------------------------------------------------------------------
--  The role list is written out rather than derived, exactly as 081 wrote it,
--  because role_permissions is a MIRROR and nothing reads it at runtime. The
--  reasoning is 094's, unchanged: making a documentation table load-bearing
--  would mean a missed sync migration silently changes who may do what.
--
--  `not public.auth_is_client()` and `public.auth_org_unlocked()` are carried
--  through verbatim. A test plan is internal, and a locked organization does
--  not write.

drop policy if exists test_cases_read on public.test_cases;
create policy test_cases_read on public.test_cases
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_override('test_case.view'),
                      coalesce(public.auth_role() in
                        ('owner','admin','manager','team_lead','qa',
                         'developer','designer','devops','employee'), false)));

drop policy if exists test_runs_read on public.test_runs;
create policy test_runs_read on public.test_runs
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_override('test_case.view'),
                      coalesce(public.auth_role() in
                        ('owner','admin','manager','team_lead','qa',
                         'developer','designer','devops','employee'), false)));

drop policy if exists test_executions_read on public.test_executions;
create policy test_executions_read on public.test_executions
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_override('test_case.view'),
                      coalesce(public.auth_role() in
                        ('owner','admin','manager','team_lead','qa',
                         'developer','designer','devops','employee'), false)));


-- ---------------------------------------------------------------------
--  PART 2 - writing a case or a run stays where it was
-- ---------------------------------------------------------------------
--  Unchanged role lists. The only edit is the override, so an organization can
--  grant one developer the ability to write cases without granting all of them.
--
--  A developer editing the test that judges their own work is the shape this
--  module refuses by default, whatever else changes.

drop policy if exists test_cases_write on public.test_cases;
create policy test_cases_write on public.test_cases
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_override('test_case.manage'),
                            coalesce(public.auth_role() in
                              ('owner','admin','manager','team_lead','qa'), false)))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_override('test_case.manage'),
                            coalesce(public.auth_role() in
                              ('owner','admin','manager','team_lead','qa'), false))
               and public.auth_org_unlocked());

drop policy if exists test_runs_write on public.test_runs;
create policy test_runs_write on public.test_runs
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_override('test_run.manage'),
                            coalesce(public.auth_role() in
                              ('owner','admin','manager','team_lead','qa'), false)))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_override('test_run.manage'),
                            coalesce(public.auth_role() in
                              ('owner','admin','manager','team_lead','qa'), false))
               and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 3 - executions: RECORDING is wide, the ROW SET is not
-- ---------------------------------------------------------------------
--  081 had one `for all` policy here. That was fine while every writer was a
--  reviewer; it is not fine now. `for all` means the list that lets somebody
--  set `result = 'failed'` also lets them DELETE the row, and a run whose
--  failures a developer can quietly remove records nothing worth having.
--
--  So the one policy becomes three, along the line the keys already draw:
--
--    UPDATE  -> test_run.execute   (wide: anybody on delivery runs a test)
--    INSERT  -> test_run.manage    (narrow: opening a run writes its scope)
--    DELETE  -> test_run.manage    (narrow: and only 081's rollback path uses it)
--
--  The `test_run_closed()` trigger from 081 still sits above all three: a
--  closed run refuses writes whoever is asking.
--
--  WHICH COLUMNS may be set is NOT expressible in a policy, so an update
--  policy that admits a developer admits them to every column on the row --
--  including `executed_by`. /api/quality writes that field itself from the
--  verified token and never from the body, which is where that particular
--  guarantee lives; RLS decides the row, the route decides the column. Said
--  plainly here rather than assumed, because the split above is exactly the
--  kind of change that invites somebody to believe RLS is doing more than it
--  is.

drop policy if exists test_executions_write on public.test_executions;

drop policy if exists test_executions_update on public.test_executions;
create policy test_executions_update on public.test_executions
  for update to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_override('test_run.execute'),
                            coalesce(public.auth_role() in
                              ('owner','admin','manager','team_lead','qa',
                               'developer','designer','devops','employee'), false)))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_override('test_run.execute'),
                            coalesce(public.auth_role() in
                              ('owner','admin','manager','team_lead','qa',
                               'developer','designer','devops','employee'), false))
               and public.auth_org_unlocked());

drop policy if exists test_executions_insert on public.test_executions;
create policy test_executions_insert on public.test_executions
  for insert to authenticated
  with check (organization_id = public.auth_org()
              and not public.auth_is_client()
              and coalesce(public.auth_override('test_run.manage'),
                           coalesce(public.auth_role() in
                             ('owner','admin','manager','team_lead','qa'), false))
              and public.auth_org_unlocked());

drop policy if exists test_executions_delete on public.test_executions;
create policy test_executions_delete on public.test_executions
  for delete to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_override('test_run.manage'),
                      coalesce(public.auth_role() in
                        ('owner','admin','manager','team_lead','qa'), false)));


-- ---------------------------------------------------------------------
--  PART 4 - verify (read-only)
-- ---------------------------------------------------------------------
--  4a) the policies that exist on the three tables, and which command each
--      covers. Expect test_executions to show three rows -- UPDATE, INSERT,
--      DELETE -- and NO row named test_executions_write.
select tablename, policyname, cmd,
       (qual like '%auth_override%' or with_check like '%auth_override%') as consults_override
  from pg_policies
 where schemaname = 'public'
   and tablename in ('test_cases','test_runs','test_executions')
 order by tablename, cmd, policyname;

--  4b) the four roles that gained something. Expect TRUE on the three read
--      policies and on test_executions_update, and FALSE everywhere else.
select policyname,
       coalesce(qual, with_check) like '%''developer''%' as admits_developer
  from pg_policies
 where schemaname = 'public'
   and tablename in ('test_cases','test_runs','test_executions')
 order by policyname;

--  4c) the closed-run trigger is still above all of it.
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.test_executions'::regclass
   and not tgisinternal;
