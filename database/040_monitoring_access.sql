-- =====================================================================
--  040 - Monitoring data: per-person access, not org-wide access
-- =====================================================================
--  THE HOLE THIS CLOSES
--
--  014 (lines 374-387) gave every desktop-tracking table one read policy:
--
--    create policy track_read on public.<t> for select to authenticated
--      using (organization_id = public.auth_org() and not public.auth_is_client())
--
--  That is org-wide. It says "any signed-in member of this organization who is
--  not a client may read every row". A developer's keystroke counts, idle
--  percentages, app-by-app timeline and screen captures are therefore readable
--  by every one of their colleagues - not through a screen, but through
--  PostgREST, with the anon key that ships in the browser bundle and their own
--  ordinary session. The product's UI shows a developer only their own data;
--  that limit has only ever existed in the UI.
--
--  019 (line 34) has the same shape for the private screenshot bucket:
--
--    create policy monitoring_read on storage.objects for select to authenticated
--      using (bucket_id = 'monitoring' and not public.auth_is_client()
--             and (storage.foldername(name))[1] = public.auth_org()::text)
--
--  Objects are keyed {organization_id}/{developer_id}/{ts}-{uuid}.png, so the
--  policy checks the org segment and ignores the developer segment entirely:
--  any non-client member can mint a signed URL for any colleague's screen
--  capture. 019 made the bucket private and then let the whole org in.
--
--  THE MODEL INSTALLED HERE (the owner's decision)
--
--    owner, admin              -> all monitoring data in the organisation
--    manager, team_lead, hr    -> their own, plus everyone who reports to them
--                                 through memberships.reports_to, transitively
--    developer, employee       -> their own record only
--    anything else / no role   -> their own record only  (fail closed)
--    client                    -> nothing  (unchanged; 014 already denies it)
--
--  The service role is untouched. It bypasses RLS entirely, so cron, the two
--  desktop ingest routes (/api/upload-screenshot, /api/track-activity) and
--  every service-role API route keep working exactly as before. Nothing here
--  touches track_insert (018) or monitoring_insert/update/delete (019).
--
--  WHY THE ROW PREDICATE IS WRITTEN AGAINST to_jsonb(row) AND NOT COLUMNS
--
--  These seven tables are not defined in any migration - they predate the
--  SaaS work and their column sets are not known to be identical across
--  deployments. This repository has already been bitten by that twice and
--  says so in writing:
--
--    011 probes information_schema before touching keyboard_stats.developer_id,
--        screenshots.developer_email, productivity_sessions.user_id, ...
--    022 "DELIBERATELY NOT INDEXED: developer_logins - the readers in src/ try
--        eight different column shapes ... Indexing a column that does not
--        exist would abort this whole migration."
--    025 ships a read-only PART 0 whose entire job is to ask the database what
--        columns developer_logins actually has.
--
--  And the shapes really are inconsistent: screenshots identifies its subject
--  with developer_id/developer_email, productivity_sessions with
--  user_id/user_email (022 confirmed it has NO developer_id), app_usage with
--  user_email and nothing else, mouse_activities with developer_id and an
--  `email` fallback, developer_logins with whichever of four columns exists.
--
--  A policy naming a column that is absent does not fail softly. The
--  `drop policy if exists` on the line above it has already succeeded, so the
--  table is left with RLS enabled and NO select policy at all - deny
--  everything, for everyone, including the owner. That is a worse outage than
--  the leak this migration is fixing, and it would land table by table.
--
--  So the identity match is done on to_jsonb(row): the helper looks for
--  whichever identity field the row actually carries, and matches it against
--  the caller's visible set. Every table gets the same policy text, no
--  statement can fail on a missing column, and a table that grows a new
--  identity column later keeps working. The cost is that the identity match
--  is not index-driven - but the org predicate in front of it is unchanged
--  and still is, and it runs first.
--
--  A row that carries no recognisable identity field is visible to owner and
--  admin only. That is deliberate: a guard that fails open is worse than no
--  guard, because it is believed. If such rows exist, PART 15's second query
--  finds them.
--
--  WHY security definer
--
--  The walk down memberships.reports_to must see the whole subtree. Under RLS
--  the caller's own select on memberships is filtered, and a walk that cannot
--  see the rows below it would return an empty subtree and quietly hide a
--  manager's own team from them. The functions read reports_to, user_id and
--  email and return only ids/emails the caller is entitled to; they disclose
--  nothing a caller could not already infer from the org chart screens.
--
--  WHY THE RECURSION IS BOUNDED AT 64
--
--  037 installs a trigger that refuses to store a reporting cycle, and 037's
--  own walks are capped at 64 for the same reason this one is: the trigger
--  judges only rows written after it was installed, so a cycle stored before
--  037 landed is still in the data. An unbounded recursive CTE over cyclic
--  data does not terminate - it turns a data problem into a hung connection,
--  on every single monitoring query. 64 is far past any real org chart.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting - function bodies are single-quoted strings on one line with their
--  inner quotes doubled - and no double-quoted identifiers, because the target
--  SQL editor mangles all four. The editor shows only the LAST statement's
--  result, so run each PART as its own query, in order.
--
--  Depends on: 010 (memberships, organizations), 012 (auth_org),
--  014 (auth_role, auth_app_user_id, auth_is_client, track_read),
--  015 (memberships.reports_to, roles team_lead + hr),
--  019 (monitoring bucket + monitoring_read), 037 (acyclic reports_to).
--  Creates no table, drops no column, rewrites no row.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY pre-flight. Run these three FIRST, one at a time.
-- ---------------------------------------------------------------------
--  0a. Which of the eight tracking tables exist here? PARTs 8-14 create one
--      policy each for the seven that 018 confirms exist. `developer_activities`
--      is deliberately absent - 018 states the table does not exist in this
--      database - and PART 14b is left commented out for the deployment where
--      it does. If 0a shows a table PARTs 8-14 do not cover, copy any of those
--      PARTs and change the table name; the policy text is identical for all.

-- select table_name from information_schema.tables where table_schema = 'public' and table_name in ('productivity_sessions','keyboard_stats','mouse_activities','app_usage','screenshots','developer_logins','browser_usage','developer_activities') order by table_name;

--  0b. Which identity columns does each of them actually carry? The helper in
--      PART 6 recognises developer_id, user_id, employee_id, member_id, dev_id
--      (as uuids) and developer_email, user_email, email, user_login,
--      login_email (as emails). Anything this query lists that is NOT in that
--      set, and that identifies a person, must be added to PART 6 before the
--      policies go on - otherwise those rows become owner/admin-only.

-- select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name in ('productivity_sessions','keyboard_stats','mouse_activities','app_usage','screenshots','developer_logins','browser_usage') and (column_name like '%user%' or column_name like '%dev%' or column_name like '%email%' or column_name like '%member%' or column_name like '%employee%' or column_name like '%login%') order by table_name, column_name;

--  0c. Does the stored hierarchy already contain a cycle? This is 037's PART 0
--      verbatim. The bound in PART 3 means a cycle cannot hang a query, but a
--      member sitting on a loop still gets a subtree that is nonsense, so fix
--      the data if this returns anything. Empty result = nothing to do.

-- with recursive walk as (select m.organization_id as org_id, m.user_id as member_user_id, m.reports_to as cursor_user_id, 1 as hops, coalesce(m.reports_to = m.user_id, false) as closed_loop from public.memberships m where m.reports_to is not null union all select w.org_id, w.member_user_id, p.reports_to, w.hops + 1, coalesce(p.reports_to = w.member_user_id, false) from walk w join public.memberships p on p.user_id = w.cursor_user_id and p.organization_id is not distinct from w.org_id where w.cursor_user_id is not null and w.closed_loop = false and w.hops < 64) select org_id as organization_id, member_user_id as user_id_on_a_cycle, hops as cycle_length from walk where closed_loop = true order by org_id, hops, member_user_id;


-- ---------------------------------------------------------------------
--  PART 1 - The index the downward walk needs (BEFORE anything walks)
-- ---------------------------------------------------------------------
--  037's index is (organization_id, user_id), which serves a walk UPWARD from
--  a member to their manager. This migration walks DOWNWARD - "who reports to
--  this person" - which probes (organization_id, reports_to) once per level.
--  Without this index every level is a seq scan of memberships, and the walk
--  runs once per monitoring query.

create index if not exists idx_memberships_org_reports_to on public.memberships(organization_id, reports_to);


-- ---------------------------------------------------------------------
--  PART 2 - try_uuid: text -> uuid, or null instead of an error
-- ---------------------------------------------------------------------
--  Two callers need this and both need it to be total.
--
--  The storage policy reads the second path segment of an object key. On a
--  legacy or hand-uploaded object that segment may not be a uuid, and a bare
--  ::uuid cast on a malformed value raises 22P02 - which, inside a policy,
--  aborts the caller's whole query rather than hiding one object. A signed-URL
--  request would turn into a 500.
--
--  The row helper reads identity fields out of jsonb, where everything is
--  text, and the same applies: one badly-typed value in one row must not take
--  down the select.
--
--  Returning null on failure means such a value matches nothing, so the row or
--  object falls through to the owner/admin branch. Fail closed, not loud.

create or replace function public.try_uuid(v text) returns uuid language plpgsql immutable as 'begin if v is null or btrim(v) = '''' then return null; end if; return btrim(v)::uuid; exception when others then return null; end';


-- ---------------------------------------------------------------------
--  PART 3 - auth_monitoring_sees_all: the owner/admin short circuit
-- ---------------------------------------------------------------------
--  Kept separate from the rest so the policies can put it first in an OR and
--  never build a subtree, or a jsonb copy of a row, for the two roles that are
--  allowed everything anyway. Reads the JWT only - no table access, so no
--  security definer.
--
--  A null role coalesces to false: an unrecognised or missing role is not an
--  owner.

--  HR AMENDMENT (applied after review, before this migration was ever run)
--
--  hr was originally in the walk list below, alongside manager and team_lead.
--  That was wrong, and the docker run proved it: hr has nobody reporting to
--  them through reports_to, so hr collapsed to one row - their own - and
--  TeamStats.jsx rendered empty. navConfig.js grants "team-stats" to
--  ["owner","admin","hr"], so the migration and the app disagreed about what
--  hr is for.
--
--  reports_to describes the LINE-MANAGEMENT tree. HR is not in anyone's line;
--  it is an org-wide function. So hr belongs in this branch, not in the walk.
--
--  If you would rather HR did NOT see every person's screenshots and keystroke
--  counts, the reverse is equally one word: remove ''hr'' from the list on the
--  next line, and remove "hr" from ADMIN_SECTION_ROLES["team-stats"] in
--  src/components/shell/navConfig.js so the two agree again.
create or replace function public.auth_monitoring_sees_all() returns boolean language sql stable as 'select coalesce(public.auth_role() in (''owner'',''admin'',''hr''), false) and not public.auth_is_client()';


-- ---------------------------------------------------------------------
--  PART 4 - auth_monitoring_subjects: whose data may the caller read?
-- ---------------------------------------------------------------------
--  Returns the set of memberships.user_id values the caller is entitled to see
--  monitoring data for. This is where the access table lives; the policies
--  below only consume it.
--
--  Five things worth knowing:
--
--  1. Clients get an empty array. 014 already denies them at the policy level
--     and PART 8-14 keep that clause, so this is the second of two locks.
--
--  2. The caller is seeded literally, not read out of memberships. A member
--     whose membership row is missing, suspended, or in a different org still
--     sees their OWN data - losing sight of your own screenshots because
--     someone suspended your membership is a support ticket, not a security
--     win.
--
--  3. Only manager, team_lead and hr walk downward. developer and employee -
--     and any role not in the list, and a null role - get exactly themselves.
--     owner and admin are in the walk list too, which costs nothing and keeps
--     this function honest if it is ever called outside a policy that already
--     OR-ed in PART 3.
--
--  4. depth < 64, exactly as 037. Cheap insurance behind 037''s trigger, which
--     only judges rows written after it was installed. Combined with the
--     c.user_id <> s.user_id guard, a stored cycle costs 64 wasted rows
--     instead of a hung backend.
--
--  5. security definer with a pinned search_path, because the subtree must be
--     read past the caller''s own RLS. A manager whose walk cannot see their
--     reports would silently get "own data only" - a guard that fails open in
--     the other direction, hiding data instead of leaking it, but just as
--     wrong and much harder to notice.

create or replace function public.auth_monitoring_subjects() returns uuid[] language plpgsql stable security definer set search_path = public, pg_temp as 'declare v_org uuid; v_self uuid; v_role text; v_ids uuid[]; begin if public.auth_is_client() then return array[]::uuid[]; end if; v_self := public.auth_app_user_id(); if v_self is null then return array[]::uuid[]; end if; v_org := public.auth_org(); v_role := public.auth_role(); if v_org is null or v_role is null or v_role not in (''owner'',''admin'',''manager'',''team_lead'',''hr'') then return array[v_self]; end if; with recursive sub as (select v_self as user_id, 0 as depth union all select c.user_id, s.depth + 1 from public.memberships c join sub s on c.reports_to = s.user_id where c.organization_id = v_org and c.user_id is not null and c.user_id <> s.user_id and s.depth < 64) select coalesce(array_agg(distinct sub.user_id), array[v_self]) into v_ids from sub; return v_ids; end';


-- ---------------------------------------------------------------------
--  PART 5 - auth_monitoring_subject_emails: the same set, by email
-- ---------------------------------------------------------------------
--  Half of these tables do not store a person''s id at all. app_usage
--  identifies its subject with user_email and nothing else; screenshots and
--  developer_logins fall back to an email column when the id is null; 011''s
--  backfill had to join on lower(email) for exactly this reason. So the id set
--  from PART 4 is not sufficient on its own.
--
--  Three sources, because staff span two tables and memberships.email is only
--  as good as the backfill that populated it: memberships.email,
--  developers.email, admin_users.email. Plus the caller''s own JWT email,
--  which is the address the desktop agent signs in with and therefore the
--  address most likely to be sitting in user_email.
--
--  Everything is lowered and trimmed on both sides of the eventual comparison.
--  memberships is org-scoped here because user_id is only unique within an
--  organisation.
--
--  security definer for the same reason as PART 4.

create or replace function public.auth_monitoring_subject_emails() returns text[] language plpgsql stable security definer set search_path = public, pg_temp as 'declare v_ids uuid[]; v_org uuid; v_emails text[]; begin v_ids := public.auth_monitoring_subjects(); if v_ids is null or array_length(v_ids, 1) is null then return array[]::text[]; end if; v_org := public.auth_org(); select coalesce(array_agg(distinct lower(btrim(s.e))), array[]::text[]) into v_emails from (select m.email as e from public.memberships m where m.user_id = any(v_ids) and m.organization_id is not distinct from v_org union all select d.email from public.developers d where d.id = any(v_ids) union all select a.email from public.admin_users a where a.id = any(v_ids) union all select nullif(auth.jwt() ->> ''email'', '''')) s where s.e is not null and btrim(s.e) <> ''''; return v_emails; end';


-- ---------------------------------------------------------------------
--  PART 6 - monitoring_row_visible: does THIS row belong to one of them?
-- ---------------------------------------------------------------------
--  The whole reason this migration is column-agnostic. Takes the row as jsonb
--  and the two sets from PARTs 4 and 5, and asks whether any identity field
--  the row happens to carry names someone in those sets.
--
--  The id list and the email list are supersets of what any one table uses -
--  a table simply has no key for the ones it lacks, and `r ->> k` on an
--  absent key is null. Add to either list if PART 0b shows an identity column
--  that is not here.
--
--  No table access and no clock, so it is immutable and needs no security
--  definer; the privileged reads all happened in PARTs 4 and 5, once per
--  query. This function is the only part that runs per row, and all it does is
--  a handful of jsonb lookups.
--
--  Unrecognised, empty, or unmatched identity -> false. The owner/admin branch
--  in the policies is what keeps such rows reachable at all.

create or replace function public.monitoring_row_visible(r jsonb, ids uuid[], emails text[]) returns boolean language plpgsql immutable as 'declare k text; v text; u uuid; begin if r is null then return false; end if; if ids is not null and array_length(ids, 1) is not null then foreach k in array array[''developer_id'',''user_id'',''employee_id'',''member_id'',''dev_id''] loop v := r ->> k; if v is not null then u := public.try_uuid(v); if u is not null and u = any(ids) then return true; end if; end if; end loop; end if; if emails is not null and array_length(emails, 1) is not null then foreach k in array array[''developer_email'',''user_email'',''email'',''user_login'',''login_email''] loop v := r ->> k; if v is not null and btrim(v) <> '''' and lower(btrim(v)) = any(emails) then return true; end if; end loop; end if; return false; end';


-- ---------------------------------------------------------------------
--  PART 7 - auth_can_read_member: the one-line form of the access table
-- ---------------------------------------------------------------------
--  "May the caller read monitoring data belonging to this member?" The storage
--  policy in PART 15 is its main consumer, because an object key carries a
--  developer id and nothing else. Application code and future policies should
--  call this rather than re-deriving the rule.
--
--  Null target -> false, so a malformed object key denies rather than throws.

create or replace function public.auth_can_read_member(target_user_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as 'select (not public.auth_is_client()) and (public.auth_monitoring_sees_all() or (target_user_id is not null and target_user_id = any (public.auth_monitoring_subjects())))';


-- ---------------------------------------------------------------------
--  PARTs 8-14 - The table policies (AFTER every function they call)
-- ---------------------------------------------------------------------
--  Identical text on all seven tables, differing only in the table name. Read
--  the clauses left to right, because that is the order they cost anything in:
--
--    organization_id = public.auth_org()   unchanged from 014. Still the first
--                                          and still the indexed one.
--    not public.auth_is_client()           unchanged from 014. Clients stay out.
--    (select ...sees_all())                owner/admin stop here.
--    monitoring_row_visible(to_jsonb(t), ...)  everyone else.
--
--  The two set-returning helpers are wrapped in scalar subqueries on purpose.
--  A bare stable function call in a policy qual is re-evaluated for every row,
--  which would run the recursive walk once per monitoring row. Wrapped in
--  (select ...) with no outer reference, the planner hoists it to an InitPlan
--  and runs it once per query. This is the difference between a policy you can
--  ship and one that melts the table.
--
--  Nothing else about these tables changes: track_insert from 018 is untouched,
--  and neither is the service role, which does not consult policies at all.
--
--  Run each PART on its own. If one fails, only that table is affected - and
--  it is left with no read policy, so re-run it before anyone uses the app.
-- ---------------------------------------------------------------------


-- PART 8 - productivity_sessions  (identifies by user_id / user_email)

drop policy if exists track_read on public.productivity_sessions;
create policy track_read on public.productivity_sessions for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(productivity_sessions), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 9 - keyboard_stats  (identifies by developer_id / user_email)

drop policy if exists track_read on public.keyboard_stats;
create policy track_read on public.keyboard_stats for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(keyboard_stats), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 10 - mouse_activities  (identifies by developer_id, email fallback)

drop policy if exists track_read on public.mouse_activities;
create policy track_read on public.mouse_activities for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(mouse_activities), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 11 - app_usage  (identifies by user_email ONLY - PART 5 is what makes
--           this table work at all)

drop policy if exists track_read on public.app_usage;
create policy track_read on public.app_usage for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(app_usage), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 12 - screenshots  (identifies by developer_id / developer_email)

drop policy if exists track_read on public.screenshots;
create policy track_read on public.screenshots for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(screenshots), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 13 - developer_logins  (column shape varies by deployment - see 022/025;
--           this is precisely the table that would have broken a
--           column-by-column policy)

drop policy if exists track_read on public.developer_logins;
create policy track_read on public.developer_logins for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(developer_logins), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 14 - browser_usage  (no reader and no writer anywhere in src/, but 018
--           gives it a track_insert policy and 014 gave it track_read, so it
--           is a real table and it gets the same lock as the rest)

drop policy if exists track_read on public.browser_usage;
create policy track_read on public.browser_usage for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(browser_usage), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- PART 14b - developer_activities. 018 states this table does NOT exist in this
--            database; 014's loop skipped it via to_regclass and this file has
--            no DO block to skip with. Uncomment both lines only if PART 0a
--            lists it.

-- drop policy if exists track_read on public.developer_activities;
-- create policy track_read on public.developer_activities for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and ((select public.auth_monitoring_sees_all()) or public.monitoring_row_visible(to_jsonb(developer_activities), (select public.auth_monitoring_subjects()), (select public.auth_monitoring_subject_emails()))));


-- ---------------------------------------------------------------------
--  PART 15 - The storage policy (AFTER auth_can_read_member)
-- ---------------------------------------------------------------------
--  Object keys are {organization_id}/{developer_id}/{ts}-{uuid}.png, written by
--  /api/upload-screenshot. 019 checked segment 1 and ignored segment 2, which
--  is how a signed URL for any colleague's screen capture became a two-line
--  fetch. Segment 2 is the developer id, so it is exactly the argument
--  auth_can_read_member wants.
--
--  try_uuid, not a bare cast: an object whose second segment is not a uuid -
--  a legacy upload, a hand-placed file, the 'unassigned' org prefix path -
--  must be invisible to non-admins, not a 500 for everybody.
--
--  ONLY monitoring_read is replaced. monitoring_insert (the desktop agent's
--  path), monitoring_update and monitoring_delete (owner/admin only) are left
--  exactly as 019 wrote them. Legacy screenshots still in the public
--  `documents` bucket are NOT covered by any of this - see the note at the
--  bottom of 019, and the count query at the bottom of this file.

drop policy if exists monitoring_read on storage.objects;
create policy monitoring_read on storage.objects for select to authenticated using (bucket_id = 'monitoring' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text and ((select public.auth_monitoring_sees_all()) or public.auth_can_read_member(public.try_uuid((storage.foldername(name))[2]))));


-- =====================================================================
--  VERIFY (read-only). Run each on its own - the editor shows only the last.
-- =====================================================================
--  1. All seven table policies present, plus the storage one.
-- select schemaname, tablename, policyname from pg_policies where (policyname = 'track_read' and schemaname = 'public') or (policyname = 'monitoring_read' and schemaname = 'storage') order by schemaname, tablename;

--  2. The four security-definer helpers are actually security definer.
-- select proname, prosecdef, proconfig from pg_proc where proname in ('auth_monitoring_subjects','auth_monitoring_subject_emails','auth_can_read_member','auth_monitoring_sees_all','monitoring_row_visible','try_uuid') order by proname;

--  3. The downward index exists.
-- select indexname from pg_indexes where schemaname = 'public' and indexname = 'idx_memberships_org_reports_to';

--  4. Sanity-check one manager's subtree by hand. Replace the uuid with a real
--     memberships.user_id; expect that member plus everyone under them.
-- with recursive sub as (select 'REPLACE-WITH-A-MANAGER-USER-ID'::uuid as user_id, 0 as depth union all select c.user_id, s.depth + 1 from public.memberships c join sub s on c.reports_to = s.user_id where c.user_id is not null and c.user_id <> s.user_id and s.depth < 64) select distinct sub.user_id, sub.depth from sub order by sub.depth, sub.user_id;

--  5. Monitoring rows nobody but owner/admin can see, because they carry no
--     identity this migration recognises. Expect 0. Anything else means PART 6
--     needs another column name - or those rows are genuinely orphaned.
-- select count(*) as unattributable_screenshots from public.screenshots where developer_id is null and developer_email is null;
-- select count(*) as unattributable_sessions from public.productivity_sessions where user_id is null and user_email is null;

--  6. Rows with no organization_id were already invisible to every
--     authenticated caller under 014 and still are - the org clause is
--     unchanged. This counts what only the service role can reach.
-- select count(*) as org_null_screenshots from public.screenshots where organization_id is null;

--  7. Legacy screenshots outside the monitoring bucket are governed by the
--     public `documents` bucket, not by PART 15. 019's tracker, repeated.
-- select count(*) as still_public from public.screenshots where storage_path like 'screenshots/%' or storage_path is null;
