-- =====================================================================
--  050 - Tracking tables: organization_id backfill + stamping backstop
-- =====================================================================
--  THE HOLE THIS CLOSES
--
--  Every read policy on the desktop-tracking tables leads with the same
--  clause. 014 line 374-387 wrote it, 040 kept it as the first predicate:
--
--    create policy track_read on public.<t> for select to authenticated
--      using (organization_id = public.auth_org() and ...)
--
--  `NULL = anything` is NULL, and NULL is not true, so a row whose
--  organization_id is NULL is invisible to every authenticated caller -
--  including the organisation's owner, who is otherwise allowed to see all
--  monitoring data. Only the service role, which bypasses RLS, can see it.
--
--  Measured on this database on 2026-08-09, before anything here was run:
--
--    table                  rows   organization_id NULL
--    screenshots              88   64   (73%)
--    keyboard_stats           83   51   (61%)
--    mouse_activities        264  217   (82%)
--    app_usage               126  100   (79%)
--    productivity_sessions    36   26   (72%)
--    developer_logins          6    0
--    browser_usage             0    0
--    developer_activities      -    table does not exist (018, 040 agree)
--
--  productivity_sessions was not in the original report but has the same
--  defect at the same rate, so it is included here.
--
--  WHAT IS *NOT* THE CAUSE - three corrections, because the fix depends on it
--
--  1. It is NOT that 013 skips these tables. 013 has TWO trg_stamp_org loops.
--     Group A (line 53) is the website tables; Group B (line 88) is exactly
--     these eight, and it installs the same before-insert trigger on every one
--     of them. The trigger is there.
--
--  2. It is NOT ongoing. The split is clean and it is temporal - every single
--     NULL row predates 2026-05-04 and every single stamped row is on or after
--     it, in all five affected tables:
--
--       screenshots            NULL 2026-04-28 .. 2026-05-03   OK 2026-05-04 ..
--       keyboard_stats         NULL 2026-04-23 .. 2026-05-03   OK 2026-05-04 ..
--       mouse_activities       NULL 2026-04-23 .. 2026-05-03   OK 2026-05-04 ..
--       app_usage              NULL 2026-04-28 .. 2026-05-03   OK 2026-05-04 ..
--       productivity_sessions  NULL 2026-04-23 .. 2026-05-03   OK 2026-05-04 ..
--
--     Nothing has arrived unstamped in three months. This is a fixed historical
--     population of 458 rows, not a leak that is still filling up.
--
--  3. What actually stamps rows today is not the trigger, it is the two ingest
--     routes. src/app/api/track-activity/route.js line 222-238 and
--     src/app/api/upload-screenshot/route.js line 214-250 both look the
--     developer up in public.developers and set organization_id from that row
--     server-side, rejecting an unknown developer with 403. That is why the
--     stamping starts on a date and never lapses.
--
--  WHY A SECOND TRIGGER IS STILL WORTH INSTALLING
--
--  Because 013's stamp_org could not have stamped these rows, and still could
--  not. Its email fallback (013 line 38-39) reads:
--
--    select d.organization_id from public.developers d
--      where lower(d.email) = lower(nullif(coalesce(r->>'user_email',
--            r->>'developer_email', r->>'email'), '')) limit 1
--
--  It resolves emails against public.developers ONLY. In this deployment the
--  tracked subject of 429 of the 458 orphan rows is zohaib6511@gmail.com,
--  which is an admin_users row (Muhammad Zohaib, org 15e9b618 "Solution Tech")
--  and is NOT in developers. stamp_org returns NULL for it. The three
--  developer_id values carried by these rows - 8fd69d30-13f6-45f1-904a-
--  efeb2ab06dee, fa42d1e2-28ff-48bd-988b-318c486dd7d1 and d48db5f9-eaef-4cce-
--  9664-31c7540d1860 - are not in developers either, so the id branch misses
--  too. Both of 013's branches miss, by construction, on exactly these rows.
--
--  So this file adds trg_stamp_org_tracking, which differs from 013's stamper
--  in three ways and in no others:
--
--    a. it resolves emails against developers AND admin_users, not developers
--       alone - which is the gap above;
--    b. it will accept an email found in developer_name / user_login, because
--       mouse_activities has no email column at all (see below);
--    c. it refuses to resolve an email that maps to more than one
--       organisation, where 013's `limit 1` would pick one arbitrarily.
--
--  It does NOT replace or drop 013's trigger. It is a separate trigger with a
--  separate name, and triggers on the same event fire in NAME order:
--  'trg_stamp_org' sorts before 'trg_stamp_org_tracking', so 013 runs first and
--  does whatever it can, and this one only fills in what is still NULL. If 013
--  was never applied here, this one works alone. Either way 013 is untouched.
--
--  One honest limit follows from that ordering, and the docker test found it
--  rather than the other way round. Difference (c) governs only the rows 013
--  leaves NULL. Where an ambiguous address is present in developers, 013
--  resolves it first with its own `limit 1`, NEW.organization_id is set by the
--  time this trigger is reached, and this trigger returns immediately - as it
--  must, because "already has a value" is indistinguishable from "the caller
--  supplied one", and overriding a supplied value is the one thing a stamping
--  trigger must never do. So (c) is a real property of PART 1's backfill in
--  every case, and of PART 2's trigger only where 013 did not already answer.
--  On this database the distinction is currently academic: no address is
--  shared between developers and admin_users at all, let alone across two
--  organisations, and none is duplicated within either table. PART 0e/3c is
--  the query that would show it if that ever changed.
--
--  THE COLUMN SHAPES ARE NOT UNIFORM - MEASURED, NOT ASSUMED
--
--  040's header says at length that these tables predate the SaaS work and
--  vary by deployment, and 011 had to probe information_schema before touching
--  them. Read from this database on 2026-08-09:
--
--    screenshots            developer_id, developer_email
--    keyboard_stats         developer_id, user_email, session_id
--    mouse_activities       developer_id, developer_name, session_id
--    app_usage              user_email, user_login, session_id  (NO id column)
--    productivity_sessions  user_id, user_email                 (NO developer_id)
--    developer_logins       developer_id                        (NO email at all)
--    browser_usage          user_email, user_login, session_id
--
--  Two of these matter a great deal:
--
--  * mouse_activities - 264 rows, the largest of the five - has NO email
--    column. Its only non-id subject is developer_name, and in this database
--    developer_name does not hold a name: 212 of the 217 orphan rows carry
--    'zohaib6511@gmail.com' in it and the other 5 carry
--    'bsf2204971@ue.edu.pk'. If developer_name is not consulted, 217 of the
--    458 orphans - 47% of the whole problem, and 82% of the biggest table -
--    stay invisible forever, because nothing else on the row identifies anyone.
--    So the email candidates below include developer_name and user_login, and
--    every email match is guarded by strpos(value, chr(64)) > 0. A column
--    holding a real name ('Zohaib', which is what app_usage.user_login holds
--    on all 100 of its orphan rows) has no '@', is rejected by the guard, and
--    can never be compared to anybody's address. A column holding an address
--    is matched on exact equality. There is no shape in which this attributes
--    a row to somebody it does not name.
--
--  * session_id is deliberately NOT used as a link. mouse_activities and
--    keyboard_stats use 'mouse_session_1777351519553'-style ids while
--    productivity_sessions uses uuids; zero of the 368 orphan rows carrying a
--    session_id match any productivity_sessions row. Chaining through it would
--    attribute nothing and would only add a way to be wrong.
--
--  NOTHING IS GUESSED
--
--  A row is stamped only when its own subject resolves to exactly ONE
--  organisation. Ids are matched against developers.id (a primary key, so
--  unique by construction). Emails are matched against the union of
--  developers.email and admin_users.email, on lower(btrim(...)) on BOTH sides
--  as 011 had to, and the match is discarded unless
--  count(distinct organization_id) = 1 for that address. An address that two
--  organisations both claim resolves to neither. Assigning monitoring data to
--  the wrong tenant is worse than leaving it invisible, so an ambiguous or
--  unrecognised subject is left alone and counted.
--
--  On this database that leaves 29 rows unattributable, in two addresses that
--  belong to no developer and no admin - bsf2205013@ue.edu.pk (13 rows) and
--  bsf2204971@ue.edu.pk (16 rows). Note the second is a near-miss for
--  developers.email = bsf2204971@gmail.com: same local part, different domain.
--  It is NOT the same person as far as this database is concerned and it is
--  not treated as one. PART 0d and PART 3b list them by address.
--
--  Predicted effect on this database, from running the derivation below
--  read-only against it on 2026-08-09 (PART 3a confirms it after the run):
--
--    table                  NULL before   by id   by email   NULL after
--    screenshots                     64       0         49           15
--    keyboard_stats                  51       0         47            4
--    mouse_activities               217       0        212            5
--    app_usage                      100       0         96            4
--    productivity_sessions           26       0         25            1
--    developer_logins                 0       0          0            0
--    browser_usage                    0       0          0            0
--    TOTAL                          458       0        429           29
--
--  The zero column is not a mistake and it is the reason the email arm carries
--  this whole migration: NOT ONE of the 458 orphan rows can be attributed by
--  id. Every developer_id and user_id they carry is one of the three values
--  listed above, and none of those is in developers. The id arm is kept
--  because it is the stronger identifier where it does resolve - it is what
--  stamps the rows the ingest routes write today, and it is what a different
--  deployment's data would lean on - but on this database it matches nothing.
--
--  ORDER: run PART 1 (backfill) BEFORE PART 2 (trigger). See the note above
--  PART 2. Both are idempotent and re-running the whole file is a no-op.
--
--  SECURITY NOTE: the two helper functions take a table name and run dynamic
--  DDL/DML, which as security definer would be a privilege-escalation route
--  for anyone able to call them. They are therefore deliberately left
--  security INVOKER, so the update or the create-trigger runs with the
--  caller's own rights and RLS: called by anon or authenticated they can do
--  nothing those roles could not already do directly, which is nothing. That
--  is what makes them safe, not the `revoke ... from public` on the line
--  after each - that is defence in depth, and it is written against public
--  alone because `anon` and `authenticated` are Supabase roles that do not
--  exist on a stock PostgreSQL, and a revoke naming a role that is not there
--  is an error that would abort the PART. Both helpers are dropped again on
--  the last line of their own PART, so nothing is left behind either way.
--  Only stamp_org_tracking() - which takes no arguments and only ever writes
--  NEW.organization_id - is security definer, for the same reason 013's
--  stamp_org is: it must read developers and admin_users past their own RLS.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting - function bodies are single-quoted strings on one line with their
--  inner quotes doubled - and no double-quoted identifiers, because the target
--  SQL editor mangles all four. The editor shows only the LAST statement's
--  result, so run each PART as its own query, in order. '@' is written
--  chr(64) throughout so that no string literal ever needs nesting inside a
--  function body inside a format() string.
--
--  Depends on: 010 (organizations, organization_id columns on these tables),
--  011 (the first, partial backfill of the same tables). Reads developers and
--  admin_users. Creates no table, drops no column, drops no policy, alters no
--  policy, and touches no object created by any other migration.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY pre-flight. Run these five FIRST, one at a time.
--           Nothing here writes. Uncomment the line and run it.
-- ---------------------------------------------------------------------
--  0a. Which of the eight tracking tables exist here, and which of them
--      actually have an organization_id column? A table missing from this
--      list is skipped by PARTs 1 and 2 rather than aborting them.

-- select t.tbl as table_name, (to_regclass('public.' || t.tbl) is not null) as table_exists, exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.tbl and c.column_name = 'organization_id') as has_organization_id from (select unnest(array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) as tbl) t order by 1;

--  0b. What is the REAL column shape of each one? This is the query whose
--      answer the header table above records. If it lists an identity column
--      that is not in the candidate arrays used by PART 1 and PART 2 -
--      developer_id, user_id, assigned_developer_id, developer_email,
--      user_email, email, admin_email, developer_name, user_login - add it
--      there before running them, or rows carrying only that column will be
--      counted unattributable.

-- select c.table_name, c.ordinal_position, c.column_name, c.data_type from information_schema.columns c where c.table_schema = 'public' and c.table_name = any (array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) order by c.table_name, c.ordinal_position;

--  0c. The before picture: rows, and how many of them no authenticated caller
--      can see. query_to_xml is used so that a table which does not exist is
--      filtered out before its count is ever parsed; offset 0 keeps the
--      planner from evaluating the count above the filter.

-- select t.tbl as table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.tbl), false, true, '')))[1]::text::bigint as rows_total, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where organization_id is null', t.tbl), false, true, '')))[1]::text::bigint as org_id_null from (select tbl from (select unnest(array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) as tbl) s where to_regclass('public.' || s.tbl) is not null and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = s.tbl and c.column_name = 'organization_id') offset 0) t order by 1;

--  0d. WHO are the invisible rows? One line per (table, subject), where the
--      subject is the first identity column the row actually carries. Run this
--      before PART 1 and again as PART 3b afterwards: every subject that
--      resolves disappears from the list, and what remains is the
--      unattributable population, named. Decide from this list whether any of
--      the leftovers is a person who should be added to developers - that is
--      the owner's call to make, not this migration's.

-- select t.tbl as table_name, (xpath('/row/s/text()', x.r))[1]::text as subject, (xpath('/row/c/text()', x.r))[1]::text::bigint as invisible_rows from (select s.tbl, string_agg(format('nullif(btrim(%I::text), '''')', s.column_name), ', ' order by array_position(array['developer_email','user_email','email','admin_email','developer_name','user_login','developer_id','user_id','assigned_developer_id'], s.column_name)) as expr from (select c.table_name as tbl, c.column_name from information_schema.columns c where c.table_schema = 'public' and c.table_name = any (array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) and c.column_name = any (array['developer_email','user_email','email','admin_email','developer_name','user_login','developer_id','user_id','assigned_developer_id']) and exists (select 1 from information_schema.columns o where o.table_schema = 'public' and o.table_name = c.table_name and o.column_name = 'organization_id')) s group by s.tbl) t, lateral unnest(xpath('/table/row', query_to_xml(format('select coalesce(%s, ''(no subject on the row)'') as s, count(*) as c from public.%I where organization_id is null group by 1', t.expr, t.tbl), false, false, ''))) as x(r) order by 3 desc, 1, 2;


--  0e. The cross-tenant baseline. This is PART 3c's query run BEFORE anything
--      is written. Keep the result: 3c re-runs it afterwards and the two must
--      match exactly. See the note above 3c for why the expectation is
--      "unchanged" and not "zero".

-- select t.tbl as table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I x join (select y.em, min(y.organization_id::text)::uuid as org from (select lower(btrim(email)) as em, organization_id from public.developers where email is not null and organization_id is not null union all select lower(btrim(email)) as em, organization_id from public.admin_users where email is not null and organization_id is not null) y group by y.em having count(distinct y.organization_id) = 1) u on u.em = lower(btrim(x.%I::text)) where x.organization_id is not null and x.organization_id <> u.org', t.tbl, t.col), false, true, '')))[1]::text::bigint as rows_stamped_to_the_wrong_org from (select c.table_name as tbl, c.column_name as col from information_schema.columns c where c.table_schema = 'public' and c.table_name = any (array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','browser_usage']) and c.column_name = any (array['developer_email','user_email','email','developer_name']) and exists (select 1 from information_schema.columns o where o.table_schema = 'public' and o.table_name = c.table_name and o.column_name = 'organization_id') offset 0) t order by 1, 2;


-- ---------------------------------------------------------------------
--  PART 1 - THE BACKFILL (existing rows). Independent of PART 2.
-- ---------------------------------------------------------------------
--  Idempotent: every update is guarded by `organization_id is null`, so a
--  second run matches nothing and reports 0 / 0 with the same leftover count.
--  Safe to run before PART 2, and safe to run again after it.
--
--  tracking_org_backfill_run(table, id_columns, email_columns) probes
--  information_schema for each candidate column and silently skips the ones
--  this deployment does not have, so a missing column costs a match, not the
--  migration. It returns what it did rather than printing it, so the single
--  statement further down reports all eight tables in one result.
--
--  The email arm resolves against a derived relation, not a `limit 1` lookup:
--  developers and admin_users are unioned, grouped by lower(btrim(email)) and
--  filtered by `having count(distinct organization_id) = 1`. An address that
--  two organisations claim produces no row and therefore stamps nothing. That
--  is the property that makes a cross-tenant assignment impossible here, and
--  it is checked by the docker test, not just asserted.

create or replace function public.tracking_org_backfill_run(p_table text, p_id_cols text[], p_email_cols text[]) returns table(table_name text, status text, stamped_by_id bigint, stamped_by_email bigint, left_unattributable bigint) language plpgsql as 'declare v_col text; v_n bigint; v_by_id bigint := 0; v_by_email bigint := 0; v_left bigint := 0; begin table_name := p_table; stamped_by_id := 0; stamped_by_email := 0; left_unattributable := 0; if to_regclass(''public.'' || p_table) is null then status := ''skipped - table does not exist''; return next; return; end if; if not exists (select 1 from information_schema.columns c where c.table_schema = ''public'' and c.table_name = p_table and c.column_name = ''organization_id'') then status := ''skipped - no organization_id column''; return next; return; end if; foreach v_col in array coalesce(p_id_cols, array[]::text[]) loop if exists (select 1 from information_schema.columns c where c.table_schema = ''public'' and c.table_name = p_table and c.column_name = v_col) then execute format(''update public.%I x set organization_id = d.organization_id from public.developers d where x.organization_id is null and d.organization_id is not null and x.%I is not null and x.%I::text = d.id::text'', p_table, v_col, v_col); get diagnostics v_n = row_count; v_by_id := v_by_id + v_n; end if; end loop; foreach v_col in array coalesce(p_email_cols, array[]::text[]) loop if exists (select 1 from information_schema.columns c where c.table_schema = ''public'' and c.table_name = p_table and c.column_name = v_col) then execute format(''update public.%I x set organization_id = u.org from (select y.em, min(y.organization_id::text)::uuid as org from (select lower(btrim(email)) as em, organization_id from public.developers where email is not null and organization_id is not null union all select lower(btrim(email)) as em, organization_id from public.admin_users where email is not null and organization_id is not null) y group by y.em having count(distinct y.organization_id) = 1) u where x.organization_id is null and x.%I is not null and strpos(x.%I::text, chr(64)) > 0 and lower(btrim(x.%I::text)) = u.em'', p_table, v_col, v_col, v_col); get diagnostics v_n = row_count; v_by_email := v_by_email + v_n; end if; end loop; execute format(''select count(*) from public.%I where organization_id is null'', p_table) into v_left; status := ''ok''; stamped_by_id := v_by_id; stamped_by_email := v_by_email; left_unattributable := v_left; return next; return; end';

revoke all on function public.tracking_org_backfill_run(text, text[], text[]) from public;

--  One statement, one result: it runs the backfill for all eight tables and
--  reports per table how many rows each arm stamped and how many are still
--  invisible. left_unattributable is the number to report to the owner.

select * from public.tracking_org_backfill_run('screenshots', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('keyboard_stats', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('mouse_activities', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('app_usage', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('productivity_sessions', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('developer_logins', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('browser_usage', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']) union all select * from public.tracking_org_backfill_run('developer_activities', array['developer_id','user_id','assigned_developer_id'], array['developer_email','user_email','email','admin_email','developer_name','user_login']);

drop function if exists public.tracking_org_backfill_run(text, text[], text[]);


-- ---------------------------------------------------------------------
--  PART 2 - THE STAMPING BACKSTOP (new rows). Independent of PART 1.
-- ---------------------------------------------------------------------
--  RUN THIS AFTER PART 1, not before. Not because PART 1 creates anything
--  PART 2 needs - it does not, and PART 2 alone is valid - but because the
--  order decides what PART 1's numbers mean. PART 1 run second would report
--  rows that PART 2's trigger had already stamped during the run as though
--  the backfill had found them, and the leftover count - the one number the
--  owner is being asked to act on - would be measured against a table that
--  had changed underneath it. Backfill the fixed historical population first,
--  read the count, then install the thing that keeps the future clean.
--
--  stamp_org_tracking returns NEW untouched the moment it sees a non-null
--  organization_id, so a caller that supplies one - which is what both ingest
--  routes do today - is never overridden. It is BEFORE INSERT only: it has no
--  opinion about updates, and it never clears a value.

create or replace function public.stamp_org_tracking() returns trigger language plpgsql security definer set search_path = public as 'declare r jsonb := to_jsonb(NEW); v_cand text; v_email text; v_org uuid; begin if (r ? ''organization_id'') and (r->>''organization_id'') is not null then return NEW; end if; select d.organization_id into v_org from public.developers d where d.organization_id is not null and d.id::text = coalesce(r->>''developer_id'', r->>''user_id'', r->>''assigned_developer_id'') limit 1; if v_org is null then foreach v_cand in array array[r->>''developer_email'', r->>''user_email'', r->>''email'', r->>''admin_email'', r->>''developer_name'', r->>''user_login''] loop continue when v_cand is null; v_email := lower(btrim(v_cand)); continue when strpos(v_email, chr(64)) = 0; select z.org into v_org from (select min(y.organization_id::text)::uuid as org, count(distinct y.organization_id) as n from (select organization_id from public.developers where organization_id is not null and lower(btrim(email)) = v_email union all select organization_id from public.admin_users where organization_id is not null and lower(btrim(email)) = v_email) y) z where z.n = 1; exit when v_org is not null; end loop; end if; if v_org is not null then NEW.organization_id := v_org; end if; return NEW; end';

--  The installer skips a table that is absent or has no organization_id
--  column, so it cannot abort on a deployment whose shape differs. Assigning
--  NEW.organization_id on a table without that column would fail at insert
--  time, which is why the column check is a precondition of attaching at all.

create or replace function public.tracking_org_attach_trigger(p_table text) returns text language plpgsql as 'begin if to_regclass(''public.'' || p_table) is null then return p_table || '' - skipped, table does not exist''; end if; if not exists (select 1 from information_schema.columns c where c.table_schema = ''public'' and c.table_name = p_table and c.column_name = ''organization_id'') then return p_table || '' - skipped, no organization_id column''; end if; execute format(''drop trigger if exists trg_stamp_org_tracking on public.%I'', p_table); execute format(''create trigger trg_stamp_org_tracking before insert on public.%I for each row execute function public.stamp_org_tracking()'', p_table); return p_table || '' - trg_stamp_org_tracking installed''; end';

revoke all on function public.tracking_org_attach_trigger(text) from public;

select public.tracking_org_attach_trigger('screenshots') as result union all select public.tracking_org_attach_trigger('keyboard_stats') union all select public.tracking_org_attach_trigger('mouse_activities') union all select public.tracking_org_attach_trigger('app_usage') union all select public.tracking_org_attach_trigger('productivity_sessions') union all select public.tracking_org_attach_trigger('developer_logins') union all select public.tracking_org_attach_trigger('browser_usage') union all select public.tracking_org_attach_trigger('developer_activities');

drop function if exists public.tracking_org_attach_trigger(text);


-- ---------------------------------------------------------------------
--  PART 3 - READ-ONLY verification. Run these four, one at a time.
-- ---------------------------------------------------------------------
--  3a. The after picture, next to the before figures recorded in the header.
--      org_id_null is what is still invisible; on this database it should be
--      15 / 4 / 5 / 4 / 1 and 0 everywhere else, 29 in total.

-- select t.tbl as table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.tbl), false, true, '')))[1]::text::bigint as rows_total, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where organization_id is not null', t.tbl), false, true, '')))[1]::text::bigint as org_id_set, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where organization_id is null', t.tbl), false, true, '')))[1]::text::bigint as org_id_null from (select tbl from (select unnest(array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) as tbl) s where to_regclass('public.' || s.tbl) is not null and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = s.tbl and c.column_name = 'organization_id') offset 0) t order by 1;

--  3b. PART 0d again. What is left is the unattributable population, named by
--      the address or id that no developer and no admin claims. Nothing here
--      was guessed at; each of these is a decision for the owner.

-- select t.tbl as table_name, (xpath('/row/s/text()', x.r))[1]::text as subject, (xpath('/row/c/text()', x.r))[1]::text::bigint as invisible_rows from (select s.tbl, string_agg(format('nullif(btrim(%I::text), '''')', s.column_name), ', ' order by array_position(array['developer_email','user_email','email','admin_email','developer_name','user_login','developer_id','user_id','assigned_developer_id'], s.column_name)) as expr from (select c.table_name as tbl, c.column_name from information_schema.columns c where c.table_schema = 'public' and c.table_name = any (array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) and c.column_name = any (array['developer_email','user_email','email','admin_email','developer_name','user_login','developer_id','user_id','assigned_developer_id']) and exists (select 1 from information_schema.columns o where o.table_schema = 'public' and o.table_name = c.table_name and o.column_name = 'organization_id')) s group by s.tbl) t, lateral unnest(xpath('/table/row', query_to_xml(format('select coalesce(%s, ''(no subject on the row)'') as s, count(*) as c from public.%I where organization_id is null group by 1', t.expr, t.tbl), false, false, ''))) as x(r) order by 3 desc, 1, 2;

--  3c. Did anything cross a tenant? Run PART 0e first and keep its numbers -
--      this is the SAME query, and the two results must be IDENTICAL, table
--      for table. It is written as a before/after comparison and not as
--      `expect zero`, because zero is the wrong expectation: a row can
--      legitimately hold an organization_id that disagrees with its own email
--      without 050 having had anything to do with it. Two ways that happens
--      here, both of them by design:
--
--        - a row that already had an organization_id when 050 ran. PART 1 only
--          ever touches `organization_id is null`, so whatever was there is
--          still there, right or wrong;
--        - a row whose developer_id resolves to one organisation while the
--          address in its email column belongs to somebody in another. The id
--          arm wins, which is correct - the id is the stronger identifier -
--          and the row then reads as a disagreement to this query.
--
--      Neither is caused by this migration, and neither is fixed by it. What
--      WOULD be caused by this migration is the count going UP between 0e and
--      3c: that, and only that, means the email arm stamped a row onto a
--      tenant its subject does not belong to. If these two runs differ, stop
--      and report it rather than running PART 2.

-- select t.tbl as table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I x join (select y.em, min(y.organization_id::text)::uuid as org from (select lower(btrim(email)) as em, organization_id from public.developers where email is not null and organization_id is not null union all select lower(btrim(email)) as em, organization_id from public.admin_users where email is not null and organization_id is not null) y group by y.em having count(distinct y.organization_id) = 1) u on u.em = lower(btrim(x.%I::text)) where x.organization_id is not null and x.organization_id <> u.org', t.tbl, t.col), false, true, '')))[1]::text::bigint as rows_stamped_to_the_wrong_org from (select c.table_name as tbl, c.column_name as col from information_schema.columns c where c.table_schema = 'public' and c.table_name = any (array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','browser_usage']) and c.column_name = any (array['developer_email','user_email','email','developer_name']) and exists (select 1 from information_schema.columns o where o.table_schema = 'public' and o.table_name = c.table_name and o.column_name = 'organization_id') offset 0) t order by 1, 2;

--  3d. Are both stampers present on all seven tables? Expect two rows per
--      table - trg_stamp_org from 013 and trg_stamp_org_tracking from here -
--      or one row if 013 was never applied to this database, which is also
--      fine. trg_stamp_org sorts first and therefore fires first.

-- select c.relname as table_name, g.tgname as trigger_name, pg_get_triggerdef(g.oid) as definition from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and g.tgisinternal = false and g.tgname like 'trg_stamp_org%' and c.relname = any (array['screenshots','keyboard_stats','mouse_activities','app_usage','productivity_sessions','developer_logins','browser_usage','developer_activities']) order by 1, 2;
