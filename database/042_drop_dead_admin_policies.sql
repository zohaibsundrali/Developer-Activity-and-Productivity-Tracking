-- =====================================================================
--  042 - Remove two dead RLS policies on admin_users
-- =====================================================================
--  These two policies were created by hand in the Supabase dashboard and
--  appear in no migration file. Migration 018's header warned that such
--  policies probably existed; these are them.
--
--    "Users can view own data"    SELECT  to public  using (auth.uid() = id)
--    "Users can update own data"  UPDATE  to public  using (auth.uid() = id)
--
--  WHY THEY ARE DEAD, MEASURED RATHER THAN ASSUMED
--
--  auth.uid() returns the Supabase Auth user's uuid, which this schema stores
--  in admin_users.auth_user_id. It is NOT admin_users.id, which is the
--  application's own primary key. Checked against the live table:
--
--    select count(*) as total_admins,
--           count(*) filter (where id = auth_user_id) as id_equals_auth_user_id
--    from public.admin_users;
--
--    total_admins = 4,  id_equals_auth_user_id = 0
--
--  So auth.uid() = id is false for every row and every caller. The policies
--  grant nothing to anyone, and dropping them changes no one's access.
--
--  WHY THEY LOOKED ALARMING AND WERE NOT
--
--  Their role list is {public}, which in PostgreSQL means EVERY role including
--  anon - not "logged-in users", which is what it is commonly mistaken for.
--  Policies are OR-ed, so a permissive {public} policy sitting beside
--  org_isolation widens access rather than narrowing it. That is worth a look
--  every time. Here the USING expression saves it: for an anonymous caller
--  auth.uid() is NULL, NULL = id evaluates to NULL rather than true, and RLS
--  admits a row only on true. admin_users - which still holds plaintext
--  passwords - was never anonymously readable.
--
--  WHY REMOVE THEM AT ALL, THEN
--
--  Because a dead policy is a trap for the next person. Anyone reading
--  pg_policies sees self-service read and update on admin_users and reasonably
--  concludes it works. The likely "fix" - changing id to auth_user_id - would
--  silently switch both policies on, granting every authenticated user direct
--  read and UPDATE of their own admin_users row outside org_isolation, on a
--  table with a plaintext password column. Deleting them removes that
--  invitation. If self-service really is wanted, it should be added
--  deliberately, scoped to authenticated, and to specific columns.
--
--  org_isolation (ALL, to authenticated) is untouched and remains the only
--  policy on this table. Nothing in src/ depends on the two being dropped:
--  every admin_users read goes through org_isolation or the service role.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting. The two policy names contain spaces and therefore MUST be
--  double-quoted - this is the one place in this migration set where a
--  double-quoted identifier is unavoidable, because that is the name the
--  dashboard gave them. Run each PART as its own query.
--
--  Reversible: the CREATE statements that restore both policies exactly are at
--  the bottom, commented out.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY. Confirm the finding on YOUR database before dropping.
-- ---------------------------------------------------------------------
--  Re-run the measurement. Only proceed if id_equals_auth_user_id is 0.
--  If it is greater than 0, these policies ARE live for those rows on your
--  deployment - stop, and do not run PART 1.

-- select count(*) as total_admins, count(*) filter (where id = auth_user_id) as id_equals_auth_user_id from public.admin_users;

--  And see the policies as they stand.

-- select policyname, cmd, roles, qual as using_expr from pg_policies where tablename = 'admin_users' order by policyname;


-- ---------------------------------------------------------------------
--  PART 1 - Drop them
-- ---------------------------------------------------------------------

drop policy if exists "Users can view own data" on public.admin_users;
drop policy if exists "Users can update own data" on public.admin_users;


-- =====================================================================
--  VERIFY (read-only). Expect exactly one row: org_isolation.
-- =====================================================================
-- select policyname, cmd, roles from pg_policies where tablename = 'admin_users' order by policyname;

--  Confirm an admin can still read their own organisation's rows through
--  org_isolation - log in as an admin in the app and open any admin screen.


-- =====================================================================
--  ROLLBACK, if ever needed - restores both exactly as they were
-- =====================================================================
-- create policy "Users can view own data" on public.admin_users for select to public using (auth.uid() = id);
-- create policy "Users can update own data" on public.admin_users for update to public using (auth.uid() = id);
