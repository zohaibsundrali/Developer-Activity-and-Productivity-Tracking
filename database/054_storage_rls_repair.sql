-- =====================================================================
--  054 - storage.objects: remove the four catch-all policies that have
--        been silently cancelling every other storage policy, and give
--        `task-submissions` the policies it never had
-- =====================================================================
--
--  WHAT WAS ACTUALLY WRONG
--
--  PostgreSQL combines PERMISSIVE policies with OR. Not AND. One policy
--  that says `true` does not "also allow" - it makes every other policy
--  on that table irrelevant, because the row only has to satisfy one of
--  them.
--
--  storage.objects had four such policies. Their names claim otherwise;
--  read the definitions, not the names:
--
--    Authenticated Upload flreew_0   INSERT  to public   with check (true)
--    Public Read Access flreew_0     SELECT  authenticated  using (true)
--    Authenticated Delete flreew_0   DELETE  authenticated  using (true)
--    Authenticated Upload flreew_1   UPDATE  authenticated  using (true)
--
--  The first one is the worst and its name is the most misleading. It is
--  granted to `public`, and in PostgreSQL `public` means EVERY role -
--  including `anon`, the role attached to the anonymous key that ships
--  inside the browser bundle and inside every copy of the desktop agent.
--  Its check is the literal `true`, with no bucket test at all.
--
--  That is not a theory. It was demonstrated against this project before
--  this file was written: an upload carrying nothing but the public anon
--  key succeeded in `screenshots`, `documents`, `task-submissions`,
--  `invoices`, `org-files`, and - with a valid JPEG payload - in
--  `monitoring`, the bucket that holds employees' screen captures. Every
--  probe object was deleted afterwards.
--
--  Migration 019 created `monitoring` with four correct policies and 040
--  narrowed them to per-person reads. Both were working exactly as
--  written the entire time. They simply never mattered, because
--  `with check (true)` sat beside them saying yes to everyone.
--
--  `Public Read Access flreew_0` is the read half of the same mistake:
--  every signed-in user of every organization could read every object in
--  every bucket - other companies' invoices, other companies' documents,
--  and all 193 objects in the legacy `screenshots` bucket.
--
--  The fifth policy dropped here, `Allow public read from
--  task-submissions`, is at least honest about its scope, but its scope
--  is "anyone at all, signed in or not, may read every file any developer
--  has ever submitted as proof of work".
--
--  WHAT THIS DOES NOT CHANGE
--
--  Nothing about buckets, objects, tables, the desktop agent, the API
--  routes, or any other schema. No object is moved or deleted. Every
--  server route that touches storage uses the service role, which does
--  not consult policies at all and is unaffected by every line below.
--
--  RUN THIS IN THE SUPABASE SQL EDITOR. Run PART 1, then PART 2, then
--  PART 3, then PART 4 - in that order, checking each. PART 4 is the
--  verification query and changes nothing.
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The helper functions, created BEFORE the policies that call
--           them (a policy referencing a missing function fails to
--           create, and PART 2 would then leave the bucket unwritable)
-- ---------------------------------------------------------------------
--
--  Why helpers at all: the `task-submissions` object path is
--
--      submissions/{developer}/{project}/{task}/{file}
--
--  and it carries NO organization segment. That path shape predates
--  multi-tenancy and is written by live code (TaskCompletionModal), so
--  this migration reads the layout that exists rather than requiring one
--  that does not. The organization therefore has to be resolved by
--  looking the developer up, and that lookup has to happen in a
--  SECURITY DEFINER function so it is not itself subject to the RLS on
--  `developers`.
--
--  Both helpers accept EITHER identifier in that second segment. The
--  browser sets it from `developers.id` once the profile has loaded, but
--  from `auth.uid()` in the moments before that - see the sessionStorage
--  branch in src/app/developer/project-details/page.jsx. A policy that
--  recognised only one spelling would reject genuine uploads whenever a
--  developer opened the modal quickly, which is exactly the kind of
--  intermittent failure nobody reports as a bug.

create or replace function public.auth_submission_visible(seg uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $fn$
  --  May the caller READ a submission filed under this path segment?
  --
  --  The organization test is inside the EXISTS, not beside it, and that
  --  is the point of the whole function. auth_can_read_member() returns
  --  true for any owner/admin/hr when handed a NULL - it is written to
  --  sit next to a separate `organization_id = auth_org()` column test,
  --  which a storage path does not have. Resolving the developer and the
  --  organization together means an unresolvable segment yields no row,
  --  and no row means false.
  --
  --  THE SELF BRANCH IS NOT REDUNDANT. auth_can_read_member() answers
  --  "may I read this OTHER person's monitoring data" - it is
  --  sees_all OR target-is-one-of-my-reports, and a person is not one of
  --  their own reports. Relying on it alone meant an ordinary developer
  --  could not read back the file they had just uploaded themselves: the
  --  signed URL behind every "view my submission" link would fail to
  --  mint, and because getSignedSubmissionUrl() returns null on failure
  --  the file would simply render as unavailable with nothing logged.
  --  It also broke re-submission, since an UPDATE carrying a WHERE clause
  --  must pass the SELECT policy before the UPDATE policy is consulted.
  --  Both were caught by the probe suite, not by reading this file.
  --  The auth column on `developers` is `auth_user_id`. There is no
  --  `user_id` on this table - a name this file used until the whole
  --  codebase was checked against the live schema. `language sql` bodies
  --  are parsed at CREATE time, so the wrong name would have failed PART 1
  --  outright and left the bucket with no policies at all.
  select exists (
    select 1
    from public.developers d
    where (d.id = seg or d.auth_user_id = seg)
      and d.organization_id = public.auth_org()
      and not public.auth_is_client()
      and (
        d.auth_user_id = auth.uid()             -- my own file
        or d.id = public.auth_app_user_id()     -- my own file, other spelling
        or public.auth_can_read_member(d.id)    -- my report's, or I see all
      )
  );
$fn$;

create or replace function public.auth_submission_mine(seg uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $fn$
  --  Is this path segment the CALLER'S OWN developer identity?
  --  Used for writes: a developer may upload under their own folder and
  --  nobody else's, regardless of role. An admin has no business writing
  --  a file into a subordinate's submission folder.
  select seg is not null
     and not public.auth_is_client()
     and exists (
       select 1
       from public.developers d
       where (d.id = seg or d.auth_user_id = seg)
         and d.organization_id = public.auth_org()
         and (d.auth_user_id = auth.uid() or d.id = public.auth_app_user_id())
     );
$fn$;


-- ---------------------------------------------------------------------
--  PART 2 - Drop the five policies
-- ---------------------------------------------------------------------
--  `if exists` so re-running is harmless. The quoted names are exact,
--  including the capitals and the underscore suffixes.

drop policy if exists "Authenticated Upload flreew_0"          on storage.objects;
drop policy if exists "Public Read Access flreew_0"            on storage.objects;
drop policy if exists "Authenticated Delete flreew_0"          on storage.objects;
drop policy if exists "Authenticated Upload flreew_1"          on storage.objects;
drop policy if exists "Allow public read from task-submissions" on storage.objects;


-- ---------------------------------------------------------------------
--  PART 3 - Give `task-submissions` its own policies
-- ---------------------------------------------------------------------
--  This bucket had NO policy of its own for INSERT, UPDATE or DELETE and
--  only the anon-read one for SELECT. Every write to it has been landing
--  purely through the catch-all dropped above, so dropping that alone
--  would break proof-of-work uploads. These four replace it.
--
--  Two path shapes are live and both are handled:
--    submissions/{developer}/{project}/{task}/{file}   TaskCompletionModal
--    pm/{organization}/{task}/{file}                   uploadTaskAttachment
--  The second already carries the organization, so it needs no lookup.

drop policy if exists task_submissions_read   on storage.objects;
drop policy if exists task_submissions_insert on storage.objects;
drop policy if exists task_submissions_update on storage.objects;
drop policy if exists task_submissions_delete on storage.objects;

--  READ - own submissions always; a colleague's only if the reader is
--  owner/admin/hr, or that person's manager. Same rule migration 047
--  applied to the task_submissions TABLE, now on the file the row points
--  at. Signing a URL requires this policy to pass, so this is what
--  getSignedSubmissionUrl() in src/utils/submissionFiles.js depends on.
create policy task_submissions_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-submissions'
    and not public.auth_is_client()
    and (
      (
        (storage.foldername(name))[1] = 'submissions'
        and public.auth_submission_visible(
              public.try_uuid((storage.foldername(name))[2]))
      )
      or (
        (storage.foldername(name))[1] = 'pm'
        and (storage.foldername(name))[2] = (public.auth_org())::text
      )
    )
  );

--  INSERT - only into your own folder, or your own organization's pm/
--  prefix. Note this is `to authenticated`, so the anon key alone can no
--  longer write here at all.
create policy task_submissions_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-submissions'
    and not public.auth_is_client()
    and (
      (
        (storage.foldername(name))[1] = 'submissions'
        and public.auth_submission_mine(
              public.try_uuid((storage.foldername(name))[2]))
      )
      or (
        (storage.foldername(name))[1] = 'pm'
        and (storage.foldername(name))[2] = (public.auth_org())::text
      )
    )
  );

--  UPDATE - required because both upload sites pass `upsert: true`, which
--  becomes an UPDATE when the object already exists. Same rule as INSERT
--  on both sides, so an upsert can never move a file out of the folder
--  the caller is allowed to write to.
create policy task_submissions_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'task-submissions'
    and not public.auth_is_client()
    and (
      (
        (storage.foldername(name))[1] = 'submissions'
        and public.auth_submission_mine(
              public.try_uuid((storage.foldername(name))[2]))
      )
      or (
        (storage.foldername(name))[1] = 'pm'
        and (storage.foldername(name))[2] = (public.auth_org())::text
      )
    )
  )
  with check (
    bucket_id = 'task-submissions'
    and not public.auth_is_client()
    and (
      (
        (storage.foldername(name))[1] = 'submissions'
        and public.auth_submission_mine(
              public.try_uuid((storage.foldername(name))[2]))
      )
      or (
        (storage.foldername(name))[1] = 'pm'
        and (storage.foldername(name))[2] = (public.auth_org())::text
      )
    )
  );

--  DELETE - owner/admin only, and only within their own organization.
--  No browser code deletes from this bucket today (checked: there is no
--  storage .remove() call anywhere in src/), so this grants nothing the
--  product currently uses. It exists so that clearing out a submission
--  is possible from the SQL editor or a future admin tool without
--  reopening the bucket.
create policy task_submissions_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-submissions'
    and public.auth_role() in ('owner', 'admin')
    and (
      (
        (storage.foldername(name))[1] = 'submissions'
        and public.auth_submission_visible(
              public.try_uuid((storage.foldername(name))[2]))
      )
      or (
        (storage.foldername(name))[1] = 'pm'
        and (storage.foldername(name))[2] = (public.auth_org())::text
      )
    )
  );


-- ---------------------------------------------------------------------
--  PART 4 - Verification. Changes nothing; run it and read the output.
-- ---------------------------------------------------------------------

--  4a. There must be NO rows here. Any row is a policy that still says
--      "yes" to everything and cancels the rest of the file.
select policyname, cmd, roles::text, coalesce(qual, '-') as using_expr,
       coalesce(with_check, '-') as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and coalesce(qual, 'true') = 'true'
  and coalesce(with_check, 'true') = 'true';

--  4b. There must be NO rows here either: nothing on storage.objects
--      should be granted to `anon` or to `public` any more.
select policyname, cmd, roles::text
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (roles::text like '%anon%' or roles::text like '%public%');

--  4c. Expect exactly 4 rows - the ones PART 3 created.
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'task_submissions_%'
order by policyname;

--  4d. RLS must be ON. It already is; this confirms nothing above
--      disturbed it.
select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'storage.objects'::regclass;


-- =====================================================================
--  AFTER RUNNING THIS - what changes, honestly
-- =====================================================================
--
--  WORKS, unchanged:
--    - desktop agent screenshot upload   monitoring_insert, {org}/{dev}/
--    - admin/HR screenshot viewing       monitoring_read
--    - invoice PDF upload                invoices policy, {org}/{invoice}/
--    - org-files upload and read         org_files_* , {org}/...
--    - organization logo upload          documents_insert
--    - proof-of-work upload and viewing  the four policies above
--    - every server route                service role, bypasses RLS
--
--  STOPS WORKING, deliberately:
--    - anonymous writes to any bucket
--    - reading another organization's objects while signed in
--    - reading the 193 legacy objects in the `screenshots` bucket with an
--      anon key. Nothing in the app reads them: resolveScreenshotUrl()
--      signs `monitoring` only and those rows already fall back to a
--      public URL that returns 400 since the bucket was made private.
--      The objects are untouched and still reachable with the service
--      role, per the instruction to leave screenshots in place for now.
--
--  SEPARATE, PRE-EXISTING BUG - NOT fixed here, flagged so it is not
--  mistaken for fallout from this file:
--    OrganizationSettings.jsx uploads the organization logo to the
--    `documents` bucket and then stores `getPublicUrl(path)`. That bucket
--    is private, so the stored URL returns 400 and the logo does not
--    render. This was already true before this migration - it broke when
--    the bucket was made private, not now. Fixing it means either moving
--    logos to `org-files` and signing them, or serving them through a
--    route; that is an application change, not a policy change.
-- =====================================================================
