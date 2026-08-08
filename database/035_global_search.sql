-- =====================================================================
--  035 - Global search: close a client leak, then make search fast
-- =====================================================================
--  PART 1 is a security fix and stands on its own. Everything after it is
--  indexes. If you run only one part today, run PART 1.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. It also shows only the LAST statement's result, so verify queries go
--  one at a time. Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The client task policy never learned about client_visible
-- ---------------------------------------------------------------------
--  Migration 032 added `developer_tasks.client_visible` and taught the client
--  API route to filter on it, which is where the internal board stopped being
--  readable through the portal. The RLS POLICY was never narrowed to match.
--
--  So the leak is still open one layer down: a client holding the anon key and
--  a valid session can select developer_tasks directly and read every task in
--  their projects, internal ones included. The route filters; the database does
--  not. Anything that queries as the user rather than through that one route -
--  a global search, for instance - walks straight into it.
--
--  This is the same predicate the route already applies, moved to where it
--  cannot be bypassed. Staff policies are untouched.

drop policy if exists developer_tasks_client_read on public.developer_tasks;
create policy developer_tasks_client_read on public.developer_tasks for select to authenticated using (public.auth_is_client() and organization_id = public.auth_org() and client_visible = true and project_id in (select public.auth_client_project_ids()));


-- ---------------------------------------------------------------------
--  PART 1b - Clients can read the employee directory. They should not.
-- ---------------------------------------------------------------------
--  013 gave these four tables the generic org policy:
--    for all to authenticated using (organization_id = auth_org())
--  with no client predicate. 018 hardened a dozen tables and never touched
--  them. So a client holding the anon key and a session can select `developers`
--  and `admin_users` and read the whole staff list, names and email addresses
--  included, plus the team and department structure.
--
--  Nothing in the client portal reads these from the browser - every client
--  screen goes through an API route on the service role - so excluding clients
--  costs the portal nothing and closes a directory that was never meant to be
--  theirs.
--
--  Staff behaviour is unchanged: same org predicate, same FOR ALL, one added
--  condition that is false only for clients.

drop policy if exists org_isolation on public.developers;
create policy org_isolation on public.developers for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client()) with check (organization_id = public.auth_org() and not public.auth_is_client());

drop policy if exists org_isolation on public.admin_users;
create policy org_isolation on public.admin_users for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client()) with check (organization_id = public.auth_org() and not public.auth_is_client());

drop policy if exists org_isolation on public.teams;
create policy org_isolation on public.teams for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client()) with check (organization_id = public.auth_org() and not public.auth_is_client());

drop policy if exists org_isolation on public.departments;
create policy org_isolation on public.departments for all to authenticated using (organization_id = public.auth_org() and not public.auth_is_client()) with check (organization_id = public.auth_org() and not public.auth_is_client());


-- ---------------------------------------------------------------------
--  PART 2 - Trigram matching
-- ---------------------------------------------------------------------
--  Search is `ILIKE '%term%'`. A leading wildcard cannot use a btree index, so
--  without this every keystroke is a sequential scan of every searchable table.
--  pg_trgm makes a GIN index usable for exactly that pattern.
--
--  Full-text search (tsvector) was the alternative and is the wrong tool here:
--  it matches whole words after stemming, so "auth" would not find
--  "authentication" and a partial task name would not find the task. Trigrams
--  match substrings, which is what someone typing into a search box expects.

create extension if not exists pg_trgm;


-- ---------------------------------------------------------------------
--  PART 3 - Indexes (AFTER the extension exists)
-- ---------------------------------------------------------------------
--  One per column the search actually reads. Nothing speculative: a trigram
--  index is large and slows writes, so a column earns one by being searched.

create index if not exists idx_projects_name_trgm on public.projects using gin (name gin_trgm_ops);
create index if not exists idx_dev_tasks_title_trgm on public.developer_tasks using gin (task_title gin_trgm_ops);
create index if not exists idx_developers_name_trgm on public.developers using gin (name gin_trgm_ops);
create index if not exists idx_developers_email_trgm on public.developers using gin (email gin_trgm_ops);
create index if not exists idx_admin_users_name_trgm on public.admin_users using gin (full_name gin_trgm_ops);
create index if not exists idx_teams_name_trgm on public.teams using gin (name gin_trgm_ops);
create index if not exists idx_clients_name_trgm on public.clients using gin (name gin_trgm_ops);
create index if not exists idx_clients_company_trgm on public.clients using gin (company gin_trgm_ops);
create index if not exists idx_sprints_name_trgm on public.sprints using gin (name gin_trgm_ops);
create index if not exists idx_epics_name_trgm on public.epics using gin (name gin_trgm_ops);
create index if not exists idx_task_comments_body_trgm on public.task_comments using gin (body gin_trgm_ops);


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select policyname, pg_get_expr(polqual, polrelid) as using_expr from pg_policies p join pg_policy pol on pol.polname = p.policyname join pg_class c on c.oid = pol.polrelid where c.relname = 'developer_tasks' and p.policyname = 'developer_tasks_client_read';
-- select extname from pg_extension where extname = 'pg_trgm';
-- select indexname from pg_indexes where schemaname = 'public' and indexname like '%_trgm' order by indexname;
