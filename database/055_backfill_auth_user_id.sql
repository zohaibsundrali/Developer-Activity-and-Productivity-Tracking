-- =====================================================================
--  055 - backfill developers.auth_user_id (and admin_users.auth_user_id)
--        from the claim that already points the other way
-- =====================================================================
--
--  THE PROBLEM
--
--  `developers.auth_user_id` is NULL on the live project's only developer
--  row. The link exists in one direction only: the Supabase auth user
--  carries `app_metadata.app_user_id` = that developer's id, but the
--  developer row does not carry the auth user's id back.
--
--  Verified on the live project before writing this file:
--
--    developers          1 row,  auth_user_id = NULL
--    auth users          2,      both with complete claims
--                                (organization_id, role, user_type, app_user_id)
--    the developer's auth user  app_user_id = 7ba66e58...
--    the developers row         id          = 7ba66e58...   <- same value
--
--  So the correct value is already known; nothing has to be guessed.
--
--  WHAT BREAKS WHILE IT IS NULL
--
--  Anything that starts from the auth user and looks for the profile:
--
--    * src/app/developer/project-details/page.jsx - the developer profile
--      lookup matches no row, so currentDeveloper falls back to a
--      synthesised object. (That fallback now prefers the JWT claim, so
--      this is no longer fatal - but a real row is better than a fallback.)
--    * developer-tracker/auth_manager.py - name and company stay blank, so
--      mouse_activities rows carry developer_name = "". More importantly
--      the status gate reads its own default of "active", which means a
--      developer whose account has been set INACTIVE can still sign in to
--      the desktop tracker. That is the one genuinely security-relevant
--      consequence and it is why this file is worth running.
--
--  SAFETY
--
--  This UPDATE only ever fills NULLs, and only where the auth user's own
--  claim names that exact row. It cannot move an existing link, cannot
--  cross organizations, and re-running it changes nothing. It does not
--  delete, drop or alter anything.
--
--  RUN PART 1 (look), then PART 2 (change), then PART 3 (confirm).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Look first. Nothing is modified by this section.
-- ---------------------------------------------------------------------

--  1a. How many rows are missing the link, and how many of those can be
--      resolved from a claim? The two numbers should match. If
--      `resolvable` is smaller, the leftover rows have no auth user
--      pointing at them and PART 2 will correctly leave them alone.
select
  (select count(*) from public.developers where auth_user_id is null) as devs_missing,
  (select count(*)
     from public.developers d
     join auth.users u
       on (u.raw_app_meta_data ->> 'app_user_id') = d.id::text
    where d.auth_user_id is null)                                     as devs_resolvable,
  (select count(*) from public.admin_users where auth_user_id is null) as admins_missing,
  (select count(*)
     from public.admin_users a
     join auth.users u
       on (u.raw_app_meta_data ->> 'app_user_id') = a.id::text
    where a.auth_user_id is null)                                     as admins_resolvable;

--  1b. Exactly which rows would change, and to what. Read this before
--      running PART 2.
select 'developer' as kind, d.id as row_id, u.id as auth_id,
       d.organization_id as row_org,
       (u.raw_app_meta_data ->> 'organization_id') as claim_org,
       ((u.raw_app_meta_data ->> 'organization_id') = d.organization_id::text) as org_agrees
from public.developers d
join auth.users u on (u.raw_app_meta_data ->> 'app_user_id') = d.id::text
where d.auth_user_id is null
union all
select 'admin', a.id, u.id, a.organization_id,
       (u.raw_app_meta_data ->> 'organization_id'),
       ((u.raw_app_meta_data ->> 'organization_id') = a.organization_id::text)
from public.admin_users a
join auth.users u on (u.raw_app_meta_data ->> 'app_user_id') = a.id::text
where a.auth_user_id is null;

--  If any row above shows org_agrees = false, STOP and ask. That would
--  mean a claim naming a profile in a different organization, which is a
--  different problem from a missing link and must not be papered over by
--  writing the link anyway.


-- ---------------------------------------------------------------------
--  PART 2 - Fill the link
-- ---------------------------------------------------------------------
--  The organization equality is part of the WHERE, not just of the
--  inspection above: a claim that names a profile in another organization
--  is refused rather than trusted.

update public.developers d
set auth_user_id = u.id
from auth.users u
where d.auth_user_id is null
  and (u.raw_app_meta_data ->> 'app_user_id') = d.id::text
  and (u.raw_app_meta_data ->> 'organization_id') = d.organization_id::text;

update public.admin_users a
set auth_user_id = u.id
from auth.users u
where a.auth_user_id is null
  and (u.raw_app_meta_data ->> 'app_user_id') = a.id::text
  and (u.raw_app_meta_data ->> 'organization_id') = a.organization_id::text;


-- ---------------------------------------------------------------------
--  PART 3 - Confirm
-- ---------------------------------------------------------------------

--  3a. Expect devs_missing = 0 and admins_missing = 0 (or, if PART 1a
--      showed unresolvable rows, expect exactly that many left).
select
  (select count(*) from public.developers  where auth_user_id is null) as devs_missing,
  (select count(*) from public.admin_users where auth_user_id is null) as admins_missing;

--  3b. No profile may end up sharing an auth user with another profile of
--      the same kind. Expect 0 rows from both.
select 'developer' as kind, auth_user_id, count(*)
from public.developers where auth_user_id is not null
group by auth_user_id having count(*) > 1
union all
select 'admin', auth_user_id, count(*)
from public.admin_users where auth_user_id is not null
group by auth_user_id having count(*) > 1;

--  3c. The link must round-trip: following auth_user_id back out to the
--      claim must land on the same row. Expect 0 rows.
select d.id
from public.developers d
join auth.users u on u.id = d.auth_user_id
where (u.raw_app_meta_data ->> 'app_user_id') is distinct from d.id::text;
