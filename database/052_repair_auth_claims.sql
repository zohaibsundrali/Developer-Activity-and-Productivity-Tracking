-- =====================================================================
--  052 - Repair JWT claims that have drifted from the database
-- =====================================================================
--  WHAT THIS FIXES, AND WHY IT LOOKED LIKE THREE DIFFERENT BUGS
--
--  RLS reads the caller's organization, role and identity from the JWT:
--  auth_org(), auth_role(), auth_user_type() and auth_app_user_id() all read
--  auth.users.raw_app_meta_data. The application reads the same facts from
--  `memberships`. Nothing keeps the two in step, so they can drift - and when
--  they do, every symptom points somewhere other than the cause:
--
--    * "Unauthorized" on Billing and System Health. getAuthedOrg() looks up a
--      membership by the app_user_id in the JWT; if that row is gone it
--      returns null and every admin API route answers 401. Reads like a
--      permissions bug in those two screens.
--
--    * "new row violates row-level security policy for table departments".
--      The app sends the organization it is holding; the policy checks the one
--      in the token. Two different organizations, so the WITH CHECK fails.
--      Reads like a bug in the departments policy.
--
--    * A demotion that never takes effect, because auth_role() still returns
--      the old role.
--
--  In every case RLS is working exactly as written. The token is wrong.
--
--  HOW CLAIMS DRIFT
--
--   1. Signing up again with an email that already has a Supabase Auth
--      account. createUser fails, and until recently the route ignored the
--      error and returned success - so a new organization existed while the
--      old Auth account kept signing the person in with the OLD org in its
--      claims. Fixed in the signup route; this migration repairs what it left.
--   2. Deleting profile rows without deleting the matching Auth user. The Auth
--      account survives, claims an organization it no longer belongs to, and
--      cannot be repaired because there is nothing to repair it TO. See the
--      orphan section below.
--   3. Any write to `memberships` that does not also update app_metadata.
--      /api/admin/members/role does update both; a direct table edit does not.
--
--  WHAT THIS FILE DOES
--
--  PART 1 reports. PART 2 repairs, and ONLY where the answer is unambiguous:
--  exactly one active membership for that email. An address with two active
--  memberships is left alone and listed - guessing which organization someone
--  belongs to is worse than leaving them logged out, because the wrong guess
--  silently grants access to a tenant they are not in.
--
--  It does not create, delete or disable any account.
--
--  AFTER RUNNING IT, EVERY REPAIRED USER MUST SIGN OUT AND BACK IN.
--  Claims are baked into the access token at issue time; an existing session
--  keeps the old ones until it refreshes.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers. Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - READ-ONLY. What is wrong, and with whom.
-- ---------------------------------------------------------------------
--  1a. Every auth user, its claims, and the membership those claims should
--      match. `verdict` says what PART 2 will do with each row.
--
--      ok               - claims already agree, nothing to do
--      will_repair      - exactly one active membership, claims differ
--      ambiguous_skip   - more than one active membership, left alone
--      orphan_no_member - no active membership at all, CANNOT be repaired

-- select u.email, m.n_active as active_memberships, u.raw_app_meta_data ->> 'organization_id' as claim_org, m.organization_id::text as db_org, u.raw_app_meta_data ->> 'app_user_id' as claim_user, m.user_id::text as db_user, u.raw_app_meta_data ->> 'role' as claim_role, m.role as db_role, case when m.n_active is null then 'orphan_no_member' when m.n_active > 1 then 'ambiguous_skip' when u.raw_app_meta_data ->> 'organization_id' is not distinct from m.organization_id::text and u.raw_app_meta_data ->> 'app_user_id' is not distinct from m.user_id::text and u.raw_app_meta_data ->> 'role' is not distinct from m.role and u.raw_app_meta_data ->> 'user_type' is not distinct from m.user_type then 'ok' else 'will_repair' end as verdict from auth.users u left join (select lower(btrim(email)) as em, count(*) as n_active, min(organization_id::text)::uuid as organization_id, min(user_id::text)::uuid as user_id, min(role) as role, min(user_type) as user_type from public.memberships where status = 'active' group by lower(btrim(email))) m on m.em = lower(btrim(u.email)) order by verdict, u.email;

--  1b. Just the count per verdict, for a quick read.

-- select case when m.n_active is null then 'orphan_no_member' when m.n_active > 1 then 'ambiguous_skip' when u.raw_app_meta_data ->> 'organization_id' is not distinct from m.organization_id::text and u.raw_app_meta_data ->> 'app_user_id' is not distinct from m.user_id::text and u.raw_app_meta_data ->> 'role' is not distinct from m.role then 'ok' else 'will_repair' end as verdict, count(*) from auth.users u left join (select lower(btrim(email)) as em, count(*) as n_active, min(organization_id::text)::uuid as organization_id, min(user_id::text)::uuid as user_id, min(role) as role from public.memberships where status = 'active' group by lower(btrim(email))) m on m.em = lower(btrim(u.email)) group by 1 order by 1;


-- ---------------------------------------------------------------------
--  PART 2 - Repair the unambiguous ones
-- ---------------------------------------------------------------------
--  Rewrites the four claims RLS depends on, from the single active membership
--  that matches the address. Any other key already in raw_app_meta_data - the
--  `provider` and `providers` keys Supabase sets, for instance - is preserved
--  by merging rather than replacing, because clobbering them breaks the
--  provider display in the Supabase dashboard and anything reading them.
--
--  Only rows whose claims actually differ are touched, so re-running this is
--  a no-op and the count it reports is meaningful.

update auth.users u set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('organization_id', m.organization_id::text, 'app_user_id', m.user_id::text, 'role', m.role, 'user_type', m.user_type) from (select lower(btrim(email)) as em, count(*) as n_active, min(organization_id::text)::uuid as organization_id, min(user_id::text)::uuid as user_id, min(role) as role, min(user_type) as user_type from public.memberships where status = 'active' group by lower(btrim(email)) having count(*) = 1) m where lower(btrim(u.email)) = m.em and (u.raw_app_meta_data ->> 'organization_id' is distinct from m.organization_id::text or u.raw_app_meta_data ->> 'app_user_id' is distinct from m.user_id::text or u.raw_app_meta_data ->> 'role' is distinct from m.role or u.raw_app_meta_data ->> 'user_type' is distinct from m.user_type);


-- ---------------------------------------------------------------------
--  PART 3 - Reconnect the profile rows
-- ---------------------------------------------------------------------
--  admin_users.auth_user_id / developers.auth_user_id link a profile to its
--  Auth account. The same events that break claims leave these null, and a
--  null one means the change-password route reports the account as
--  `legacy_only_account` and refuses - correctly, since it has no credential
--  to change.
--
--  Matched on email, and only where the profile row is currently unlinked, so
--  an existing link is never repointed.

update public.admin_users a set auth_user_id = u.id from auth.users u where a.auth_user_id is null and lower(btrim(a.email)) = lower(btrim(u.email));

update public.developers d set auth_user_id = u.id from auth.users u where d.auth_user_id is null and lower(btrim(d.email)) = lower(btrim(u.email));


-- =====================================================================
--  VERIFY (read-only). Re-run PART 1b - expect only 'ok' and, if you have
--  them, 'orphan_no_member'. Then sign out and back in.
-- =====================================================================

--  Profile rows still unlinked after PART 3. Each of these is an account that
--  exists in the app but has no Supabase Auth credential, so nobody can sign
--  in as it. Provisioning them is a separate decision - see 041 stage 3.
-- select 'admin_users' as tbl, email from public.admin_users where auth_user_id is null union all select 'developers', email from public.developers where auth_user_id is null order by 1, 2;


-- =====================================================================
--  ORPHANED AUTH ACCOUNTS - read this before deciding
-- =====================================================================
--  An Auth account whose email has no active membership cannot be repaired:
--  there is no organization to point it at. It can still sign in, and then
--  every API route answers 401 and every RLS check fails, which is a
--  confusing state to leave a real person in.
--
--  This file deliberately does NOT delete them. Deleting an Auth user is
--  irreversible and the right answer depends on why the membership is
--  missing - a suspended member, a half-finished invitation, and a leftover
--  from a data reset all look identical here.
--
--  List them:
-- select u.email, u.created_at, u.raw_app_meta_data ->> 'organization_id' as claims_org from auth.users u where lower(btrim(u.email)) not in (select lower(btrim(email)) from public.memberships where status = 'active' and email is not null) order by u.created_at;
--
--  Then, per account, either restore the membership (Organization -> Members)
--  or remove the Auth user from Supabase -> Authentication -> Users. Removing
--  it is what frees the address for a fresh signup; leaving it is what makes
--  the next signup with that address fail.
