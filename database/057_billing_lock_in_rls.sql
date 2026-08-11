-- =====================================================================
--  057 - enforce the billing lock in the DATABASE, not only in the API
-- =====================================================================
--
--  WHAT IS WRONG TODAY
--
--  `requireUnlocked()` (src/utils/entitlements.js) guards the API routes, and
--  `BillingGate` hides the UI. Neither is a boundary. src/utils/pmData.js talks
--  to PostgREST DIRECTLY from the browser with the anon key and the user's JWT
--  — it never passes through a route of ours — so an organization whose trial
--  has expired can still create tasks, sprints, epics, comments, checklists,
--  time logs, labels and custom fields by using the product exactly as before.
--  The lock screen is a screen; the writes underneath it were never stopped.
--
--  This is the same shape as every other finding in this series: an
--  application-layer check standing in for a database one. The fix is the same
--  shape too — put the rule where the write actually lands.
--
--  WHAT THIS CHANGES
--
--  One predicate, `public.auth_org_unlocked()`, added to the WITH CHECK of
--  every policy that permits a WRITE on the project-management tables.
--
--  Reads are deliberately NOT touched. A locked organization must still be
--  able to SEE its own data — locking someone out of the record of work they
--  have already done, because an invoice failed, is not a billing control, it
--  is holding data hostage. They can read everything and change nothing until
--  they pay.
--
--  BECAUSE POLICIES ARE OR'D, EVERY WRITE-CAPABLE POLICY ON A TABLE HAS TO
--  CARRY THE PREDICATE. Adding it to one and leaving a second permissive
--  policy in place would achieve nothing — that is precisely how migration
--  054's storage catch-alls nullified the correct policies beside them. The
--  list below was taken from `pg_policies` on the live project, not from the
--  migration files, because those two had already disagreed once.
--
--  RUN PART 1, then PART 2, then PART 3 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The predicate
-- ---------------------------------------------------------------------
--
--  This MUST agree with accessState() in src/utils/billingAccess.js. If the
--  database and the UI disagree, the product tells a paying customer one thing
--  and does another — so the branches below are in the same order, with the
--  same defaults, as the JavaScript:
--
--    no subscription row .... open   (fail open; a lock is the dangerous
--                                     direction to guess in)
--    free plan .............. open   (free is a destination, not a countdown)
--    trialing, no end date .. open   (deliberate open-ended grant; 053 PART 3
--                                     puts the owner's own org here)
--    trialing, past end ..... LOCKED
--    past_due, no grace end . open
--    past_due, past grace ... LOCKED
--    unpaid ................. LOCKED
--    anything else .......... open
--
--  SECURITY DEFINER because the caller may not be able to read
--  organization_subscriptions under its own policies, and STABLE so the
--  planner evaluates it once per statement rather than once per row.

create or replace function public.auth_org_unlocked()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $fn$
  select coalesce(
    (
      select case
        when s.plan_code = 'free'   then true
        when s.status = 'trialing'  then (s.trial_end is null or now() <= s.trial_end)
        when s.status = 'past_due'  then (s.grace_period_ends_at is null
                                          or now() <= s.grace_period_ends_at)
        when s.status = 'unpaid'    then false
        else true
      end
      from public.organization_subscriptions s
      where s.organization_id = public.auth_org()
      limit 1
    ),
    true  -- no row: fail OPEN
  );
$fn$;


-- ---------------------------------------------------------------------
--  PART 2 - Carry the predicate into every write-capable policy
-- ---------------------------------------------------------------------
--
--  Each policy is recreated with its EXISTING rule intact and the lock added.
--  Nothing about tenant isolation, client exclusion or role scoping changes;
--  read the diff as "same rule, and not locked".

-- ── FOR ALL policies (their WITH CHECK governs insert and update) ──────
--  `org_isolation` is a single FOR ALL policy on each of these, so its USING
--  half also governs UPDATE and DELETE row selection. The lock goes in the
--  WITH CHECK only: USING must stay as it is so a locked organization can
--  still read, and so DELETE keeps working (removing your own data is not a
--  thing to hold to ransom either).

drop policy if exists org_isolation on public.developer_tasks;
create policy org_isolation on public.developer_tasks for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.sprints;
create policy org_isolation on public.sprints for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.epics;
create policy org_isolation on public.epics for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.task_checklists;
create policy org_isolation on public.task_checklists for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.task_dependencies;
create policy org_isolation on public.task_dependencies for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.task_attachments;
create policy org_isolation on public.task_attachments for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.project_labels;
create policy org_isolation on public.project_labels for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

drop policy if exists org_isolation on public.project_custom_fields;
create policy org_isolation on public.project_custom_fields for all to authenticated
  using       (organization_id = public.auth_org() and not public.auth_is_client())
  with check  (organization_id = public.auth_org() and not public.auth_is_client()
               and public.auth_org_unlocked());

--  saved_views is DELIBERATELY LEFT ALONE. A saved view is a personal filter,
--  not project data — locking someone out of renaming their own list is
--  billing pressure applied to the wrong thing, and it produces a confusing
--  failure ("why can't I save a view?") that has nothing to do with the
--  invoice. Left as-is on purpose, not overlooked.

-- ── Named single-command policies ─────────────────────────────────────

drop policy if exists pm_activity_insert on public.pm_activity;
create policy pm_activity_insert on public.pm_activity for insert to authenticated
  with check (organization_id = public.auth_org() and not public.auth_is_client()
              and public.auth_org_unlocked());

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (organization_id = public.auth_org() and not public.auth_is_client()
              and public.auth_org_unlocked());

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update to authenticated
  using      (organization_id = public.auth_org()
              and (author_id = public.auth_app_user_id()
                   or public.auth_role() = any (array['owner','admin','manager'])))
  with check (organization_id = public.auth_org() and public.auth_org_unlocked());

--  task_comments_client_insert is NOT given the lock. A client commenting on
--  their own project is the customer of the organization, not the account
--  holder — they have no way to pay the bill and no way to find out why they
--  were silenced. The organization's own staff are the ones the lock is meant
--  to press on.

drop policy if exists task_time_logs_insert on public.task_time_logs;
create policy task_time_logs_insert on public.task_time_logs for insert to authenticated
  with check (organization_id = public.auth_org() and not public.auth_is_client()
              and (developer_id = public.auth_app_user_id()
                   or public.auth_role() = any (array['owner','admin']))
              and public.auth_org_unlocked());

drop policy if exists task_time_logs_update on public.task_time_logs;
create policy task_time_logs_update on public.task_time_logs for update to authenticated
  using      (organization_id = public.auth_org()
              and (developer_id = public.auth_app_user_id()
                   or public.auth_role() = any (array['owner','admin'])))
  with check (organization_id = public.auth_org() and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 3 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  3a. The predicate answers for THIS organization. Run it as yourself in the
--      SQL editor and it will read `auth_org()` as NULL, so expect `true`
--      (no row matched -> fail open). That is the fail-open branch working,
--      not the lock being absent.
select public.auth_org_unlocked() as unlocked_for_current_claims;

--  3b. Every write-capable policy below must show auth_org_unlocked in its
--      check_expr. Expect 13 rows, all with `has_lock = true`.
select tablename, policyname, cmd,
       (with_check like '%auth_org_unlocked%') as has_lock
from pg_policies
where schemaname = 'public'
  and cmd in ('ALL', 'INSERT', 'UPDATE')
  and tablename in ('developer_tasks','sprints','epics','task_checklists',
                    'task_dependencies','task_attachments','project_labels',
                    'project_custom_fields','pm_activity','task_comments',
                    'task_time_logs')
  and policyname not in ('task_comments_client_insert')
order by tablename, policyname;

--  3c. Reads must be untouched — expect NO row here to mention the lock.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and cmd = 'SELECT'
  and coalesce(qual, '') like '%auth_org_unlocked%';

--  3d. Sanity: what the live subscription actually says. A locked
--      organization here means the lock will bite immediately after PART 2.
select organization_id, plan_code, status, trial_end, grace_period_ends_at
from public.organization_subscriptions;


-- =====================================================================
--  AFTER RUNNING THIS
--
--  A locked organization can still: sign in, read every task, sprint, comment
--  and time log it has ever created, export, and pay.
--
--  It can no longer: create or edit tasks, sprints, epics, checklists,
--  dependencies, attachments, labels, custom fields, comments or time logs —
--  from the UI or by talking to PostgREST directly, which is the point.
--
--  Clients of a locked organization are unaffected: they can still read their
--  project and still comment on it.
-- =====================================================================
