-- =====================================================================
--  051 - Drop NOT NULL from the legacy password columns
-- =====================================================================
--  FIX FOR A LIVE BREAKAGE. Signing up currently fails with:
--
--    null value in column "password" of relation "admin_users"
--    violates not-null constraint
--
--  and accepting an invitation fails the same way on `developers`.
--
--  WHY IT BROKE
--
--  These three tables each carried a cleartext `password` column, left over
--  from a login path that predates Supabase Auth. A recent change stopped
--  every writer from putting a password into them, because the address of the
--  real credential is Supabase Auth and a second copy in a table any org
--  member can read is a liability, not a feature.
--
--  Stopping the writes was right. What was missed is that two of the three
--  columns are NOT NULL, so an insert that omits the field is rejected by the
--  constraint rather than storing a null. `clients.password` was already
--  nullable, which is why the client path kept working and hid the problem.
--
--  WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--
--  Drops the NOT NULL constraint. That is all. It does not drop the columns,
--  does not touch a single stored value, and does not change any policy.
--
--  Every password already written stays exactly where it is - still cleartext,
--  still readable by any authenticated member of the same organisation. This
--  migration does not improve that and does not pretend to. Clearing those
--  values is stage 5 of the plan written into 041, and it needs a service-role
--  script rather than SQL, because the hash has to be derived per row.
--
--  So the honest description is: this unblocks account creation, and leaves
--  the exposure exactly as it was.
--
--  WHY NOT JUST WRITE SOMETHING INTO THE COLUMN
--
--  Because every candidate is worse. Writing the real password back is the
--  thing that was removed. Writing a placeholder puts a value that looks like
--  a credential into a column named `password`, where the next person to read
--  the table cannot tell it apart from a real one. Nullable is the truthful
--  state: there is no password here, because the password lives in Auth.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers. Run each PART as its own query.
--
--  Reversible: the two statements that restore the constraints are at the
--  bottom, commented out. Note they will fail if any row has a null password
--  by then, which is the point - the constraint cannot come back once the
--  column is genuinely in use as "optional".
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY. Confirm the state before changing it.
-- ---------------------------------------------------------------------
--  Expect admin_users NO, developers NO, clients YES before PART 1;
--  all three YES afterwards.

-- select table_name, is_nullable from information_schema.columns where table_schema = 'public' and column_name = 'password' and table_name in ('admin_users', 'developers', 'clients') order by table_name;

--  How many rows still hold a cleartext password. This is the number 041
--  stage 5 has to clear; it does not change here.

-- select 'admin_users' as tbl, count(*) filter (where password is not null and password not like 'pbkdf2$%') as cleartext, count(*) filter (where password like 'pbkdf2$%') as hashed, count(*) filter (where password is null) as empty from public.admin_users union all select 'developers', count(*) filter (where password is not null and password not like 'pbkdf2$%'), count(*) filter (where password like 'pbkdf2$%'), count(*) filter (where password is null) from public.developers union all select 'clients', count(*) filter (where password is not null and password not like 'pbkdf2$%'), count(*) filter (where password like 'pbkdf2$%'), count(*) filter (where password is null) from public.clients;


-- ---------------------------------------------------------------------
--  PART 1 - Drop the constraints
-- ---------------------------------------------------------------------
--  `clients` is included even though it is already nullable, so that re-running
--  this file on a deployment whose clients table differs converges to the same
--  shape. Dropping a NOT NULL that is not there is a no-op, not an error.

alter table public.admin_users alter column password drop not null;
alter table public.developers alter column password drop not null;
alter table public.clients alter column password drop not null;


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
--  All three should now read YES.
-- select table_name, is_nullable from information_schema.columns where table_schema = 'public' and column_name = 'password' and table_name in ('admin_users', 'developers', 'clients') order by table_name;

--  Then create an organisation through /admin/registration and accept an
--  invitation. Both should complete, and both new rows should show a null
--  password with a populated auth_user_id - the credential is in Auth.
-- select email, password is null as no_legacy_password, auth_user_id is not null as linked_to_auth from public.admin_users order by created_at desc limit 3;


-- =====================================================================
--  ROLLBACK - only possible while every row still has a value
-- =====================================================================
-- alter table public.admin_users alter column password set not null;
-- alter table public.developers alter column password set not null;
