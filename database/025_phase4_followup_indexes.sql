-- =====================================================================
--  025 - Phase 4 follow-up indexes
-- =====================================================================
--  Three index sets that migration 022 could not include:
--
--   1. productivity_sessions.user_id. 022 indexed (user_email, ...) only,
--      because at the time reportsData filtered desktop sessions by
--      developer_id - a column this database does not have. That filter was
--      changed to user_id, which left the new query shape unindexed.
--
--   2. developer_tasks ordered the way the board actually reads it. 022 has
--      (project_id, task_order), but loadTasks sorts by position, then
--      task_order, then id - the id tiebreaker is required for range paging to
--      be stable, and without it a row can appear on two pages or on none.
--
--   3. developer_logins, now that PART 0 has reported its real columns:
--      id, developer_id, login_time, login_date, organization_id. Six of the
--      eight shapes its reader probed named columns that do not exist, so those
--      probes are gone from the code and only the two workable ones are indexed.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles both. It also shows only the LAST
--  statement's result, so run verify queries ONE AT A TIME.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - What columns does developer_logins actually have? (read-only)
--  Already answered: id, developer_id, login_time, login_date, organization_id.
--  Kept for the next deployment, where the shape may differ.
-- ---------------------------------------------------------------------
-- select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'developer_logins' order by ordinal_position;


-- ---------------------------------------------------------------------
--  PART 1 - Desktop sessions by user_id
-- ---------------------------------------------------------------------

create index if not exists idx_sessions_user_id_start on public.productivity_sessions (user_id, start_time desc);


-- ---------------------------------------------------------------------
--  PART 2 - The board's real sort order
-- ---------------------------------------------------------------------
--  Two shapes because loadTasks scopes by project when a project is open and by
--  organization when it is not.

create index if not exists idx_dev_tasks_project_board_order on public.developer_tasks (project_id, position, task_order, id);
create index if not exists idx_dev_tasks_org_board_order on public.developer_tasks (organization_id, position, task_order, id);


-- ---------------------------------------------------------------------
--  PART 3 - developer_logins, the two shapes its reader can actually use
-- ---------------------------------------------------------------------
--  Both read a time window: one narrowed to a developer, one across the
--  organization when the developer id is unknown.

create index if not exists idx_developer_logins_dev_time on public.developer_logins (developer_id, login_time);
create index if not exists idx_developer_logins_org_time on public.developer_logins (organization_id, login_time);


-- =====================================================================
--  VERIFY (read-only). Run this ONE query on its own - expected: 5 rows.
-- =====================================================================
-- select indexname from pg_indexes where schemaname = 'public' and indexname in ('idx_sessions_user_id_start','idx_dev_tasks_project_board_order','idx_dev_tasks_org_board_order','idx_developer_logins_dev_time','idx_developer_logins_org_time') order by indexname;
