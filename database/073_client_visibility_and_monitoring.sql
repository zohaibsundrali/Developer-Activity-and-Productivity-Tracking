-- ============================================================================
--  073 - Two rules the catalogue states and the database does not enforce:
--        who may publish a task to the client portal, and who may read the
--        monitoring surface.
--
--  These are two findings and they would normally be two files. They are one
--  file because they are the same MISTAKE in two places — a role list that
--  lives in src/utils/permissionCatalogue.js and has no counterpart in the
--  layer the browser actually talks to — and because both are one statement.
--  PART 2/3 and PART 4 are independent: either may be applied without the
--  other, in either order, and neither depends on the other's result.
--
--  ==========================================================================
--  FINDING 1 - `task.set_client_visibility` HAD ZERO SERVER-SIDE ENFORCEMENT
--  ==========================================================================
--
--  The catalogue key exists and names three roles:
--
--    src/utils/permissionCatalogue.js line 173
--      { key: "task.set_client_visibility", roles: DECIDERS, ... }
--    line 85
--      const DECIDERS = ["owner", "admin", "manager"];
--
--  Grepped, that key is referenced in exactly TWO places in the whole repo:
--  the catalogue entry itself, and one line of JSX —
--
--    src/components/admin/TaskDetailDrawer.jsx line 699
--      const canSetClientVisibility = allowed("task.set_client_visibility");
--
--  — which decides whether a checkbox is RENDERED. That is the entire
--  enforcement story. There is no API route in front of the write. The path is:
--
--    TaskDetailDrawer.jsx:1005  saveField("client_visible", e.target.checked)
--      -> src/utils/pmData.js:205  updateTask(taskId, patch)
--      -> supabase.from("developer_tasks").update({...}).eq("id", taskId)
--
--  and that `supabase` is src/utils/supabaseClient.js — the ANON-KEY PostgREST
--  client that ships in the browser bundle, bound to the caller's own JWT. The
--  only server-side rule the write passes through is the RLS policy, and after
--  057 that policy reads (057 lines 108-111):
--
--    create policy org_isolation on public.developer_tasks for all
--      to authenticated
--      using      (organization_id = public.auth_org()
--                  and not public.auth_is_client())
--      with check (organization_id = public.auth_org()
--                  and not public.auth_is_client()
--                  and public.auth_org_unlocked());
--
--  THERE IS NO ROLE TERM IN IT AT ALL. `for all` covers UPDATE, and
--  `client_visible` is an ordinary boolean column of the table (032 line 36).
--  So any authenticated non-client member of the organisation — a developer, a
--  designer, a qa, an employee, a finance user, a team_lead — can run, from the
--  browser console of a page they are legitimately signed in to:
--
--    await supabase.from('developer_tasks')
--      .update({ client_visible: true })
--      .eq('id', '<any task id in my org>')
--
--  and that task is now in the client portal. Not just its flag: 035 PART 1's
--  `developer_tasks_client_read` keys the client's read of the TASK on
--  `client_visible = true`, and 033 lines 101-102 key the client's read of its
--  COMMENTS on the same column through a subquery. So one boolean hands a
--  client the task's title, description and every non-internal comment on it —
--  the internal board that 032 and 035 were written to keep separate.
--
--  Hiding the checkbox is not a permission. It is the first of the three gates
--  sectionAccess.js names in its header, and the other two were missing.
--
--  WHY THE FIX IS IN THE DATABASE
--
--  Because the database is the layer the browser talks to. Adding a route and
--  pointing TaskDetailDrawer at it would leave the direct-PostgREST path
--  exactly as open as it is today; the attack does not go through the UI. The
--  same reasoning as 070: the rule exists in the application (as a catalogue
--  key), it is enforced on a code path the attack never takes, and moving it
--  into the database is what makes it real.
--
--  WHY A TRIGGER AND NOT A POLICY - the argument is 048's, unchanged
--
--  The rule is COLUMN-level and conditional on the caller: a developer may
--  update their own task — status, notes, estimate, labels — and may NOT move
--  `client_visible`. An RLS `with check` is a row predicate; it sees the whole
--  NEW row and has no vocabulary for "this column changed". The nearest a
--  policy could get is `with check (client_visible = false)`, which is not the
--  rule — it would forbid a developer from touching ANY column of an
--  already-published task. Column-level GRANTs are per-database-role and every
--  staff member is the same database role (`authenticated`) with their app role
--  in a JWT claim, so there is nothing to grant to. A BEFORE UPDATE trigger
--  comparing OLD to NEW is the only form that expresses it. See 048's "WHY A
--  TRIGGER AND NOT A POLICY" for the long version; nothing about that argument
--  is specific to task_submissions.
--
--  This trigger is an OVERLAY on 057's policy, not a replacement. 057 still
--  decides which ROWS a caller may update at all (own org, not a client, org
--  not billing-locked); this decides which COLUMN of those rows may move.
--
--  THE ENTITLED SET IS DECIDERS, CHARACTER FOR CHARACTER
--
--    owner, admin, manager — permissionCatalogue.js line 85 / line 173.
--
--  Deliberately NOT the review set and NOT the monitoring set. team_lead is
--  absent and TaskDetailDrawer.jsx lines 691-698 say why in prose: a team lead
--  can legitimately move any card on the board and is not the person who
--  decides that "chase the client about the overdue invoice" is something the
--  client gets to read. If DECIDERS is ever changed, PART 2 changes with it in
--  the same commit — tests/roleIdentityAndRls.test.js parses the role list out
--  of this file and compares it to the catalogue, so a one-sided edit fails CI
--  rather than drifting silently.
--
--  ==========================================================================
--  FINDING 2 - RLS GAVE `hr` THE ENTIRE MONITORING SURFACE
--  ==========================================================================
--
--    database/040_monitoring_access.sql line 205
--      create or replace function public.auth_monitoring_sees_all()
--        returns boolean language sql stable as
--        'select coalesce(public.auth_role()
--           in (''owner'',''admin'',''hr''), false)
--         and not public.auth_is_client()';
--
--  That function is the FIRST TERM of an OR in the read policy of every
--  monitoring table in the product. When it returns true the rest of the
--  predicate is never evaluated and the caller sees every row in the
--  organisation. Grepped, its consumers are:
--
--    040: productivity_sessions, keyboard_stats, mouse_activities, app_usage,
--         screenshots, developer_logins, browser_usage, the `monitoring`
--         storage bucket policy (line 409), and auth_can_read_member (line 303)
--    044: activity_logs
--    045: admin_reviews
--    046: task_time_logs, pm_activity
--    047: task_submissions
--
--  The catalogue says the opposite:
--
--    permissionCatalogue.js line 188
--      { key: "monitoring.view", roles: ADMINS, module: "oversight", ... }
--    line 68
--      const ADMINS = ["owner", "admin"];
--
--  and src/components/shell/sectionAccess.js lines 65-75 states the intent in
--  so many words, about this exact surface: "...returned true for all seven
--  roles the area admits, including hr and finance, who are deliberately kept
--  off the monitoring surface."
--
--  So an `hr` could read every employee's keystroke counts, activity log, time
--  log and screenshot — directly from the browser, with the anon key, no API
--  route involved, because RLS said yes. The UI never offered it; RLS is not
--  the UI.
--
--  THIS IS A PRIVACY MATTER, NOT ONLY AN ACCESS-CONTROL ONE. The product
--  records DOMAIN-LEVEL BROWSING (browser_usage), plus screenshots and
--  keystroke counts. The disclosure the organisation makes to its staff is
--  written against the set of people who can see that data. Widening that set
--  by accident is not a permissions bug that can be tidied up later.
--
--  WHY 040 GOT IT WRONG, since the file argues for it at length
--
--  040's "HR AMENDMENT" block (lines 194-204) moved hr from the reports_to
--  WALK into this short-circuit, and its reasoning about the walk is CORRECT:
--  reports_to is the line-management tree, HR is not in anyone's line, so
--  walking it collapses hr to a single row and TeamStats.jsx renders empty.
--  What does not follow is the conclusion. "hr's subtree is empty" argues that
--  the walk is the wrong mechanism for hr; it does not argue that hr should
--  therefore see EVERYTHING. The nav entry 040 cites as its evidence —
--  "team-stats" — is `team_stats.view` in today's catalogue (sectionAccess.js
--  line 59), whose role list is PEOPLE = owner/admin/hr and which is a
--  HEADCOUNT screen. `monitoring.view` is the keystroke/screenshot surface and
--  its list is ADMINS. 040 read one nav entry as authority over a dozen tables.
--
--  040 also wrote down the reverse instruction, and this file is it:
--  "If you would rather HR did NOT see every person's screenshots and keystroke
--  counts, the reverse is equally one word: remove ''hr'' from the list on the
--  next line..."
--
--  WHAT hr LOSES, EXACTLY - read this before applying
--
--  hr stays in the `auth_monitoring_subjects()` walk list (040 PART 4), and
--  that walk collapses to `array[v_self]` for hr, for the reason 040 explains.
--  So after this file an hr user sees THEIR OWN monitoring rows and nobody
--  else's, on every table in the list above. Concretely, hr loses:
--
--    * every screen backed by keyboard_stats / activity_logs / screenshots /
--      browser_usage / app_usage / task_time_logs / pm_activity;
--    * org-wide reads of task_submissions (047) and admin_reviews (045). Note
--      that hr was never a REVIEWER — /api/admin-review's REVIEWER_ROLES is
--      ['owner','admin','manager'] and 048's trigger enforces it — so this
--      removes hr's ability to READ submissions it could never rule on;
--    * `monitoring` bucket objects belonging to other people (040 line 409).
--
--  hr keeps everything people-ops: member.view, team_stats.view (a headcount
--  count, not a monitoring read), hierarchy, the employee directory, and every
--  non-role column of a membership row (018, as narrowed by 070).
--
--  IF THAT IS NOT THE PRODUCT DECISION, the honest fix is to add `hr` to
--  `monitoring.view` in permissionCatalogue.js and to this function IN THE SAME
--  COMMIT — not to leave the two disagreeing. The test parses both.
--
--  ONE SCREEN NEEDS A MATCHING EDIT AND IT IS NOT IN THIS FILE:
--  src/components/shell/navConfig.js line 143 sends hr to MANAGER_NAV, and the
--  admin sidebar's monitoring entries are already derived from the catalogue
--  (sectionAccess.js line 87, ADMIN_SECTION_ROLES), so hr is ALREADY not
--  offered "developer-activity" or "productivity" in the UI. That is the whole
--  point: the UI has been right and the database has been wrong. No component
--  change is required by this file. If a TeamStats-style screen is found to be
--  reading a monitoring TABLE rather than the headcount aggregate, that screen
--  is the thing to fix, not this function.
--
--  ==========================================================================
--  FINDING 3 - `user_type` FOR AN INVITED `hr`. NO SQL HERE, ON PURPOSE.
--  ==========================================================================
--
--  Recorded here because it is a DATA condition this file's reader is the right
--  person to know about, and because PART 1 gives them the query to measure it.
--  THIS FILE WRITES NO ROW. It does not move anybody between profile tables.
--
--  THE BUG. Two places computed `user_type` from a role and disagreed:
--
--    src/utils/roles.js lines 66-70   userTypeForRole()
--      client -> "client"; owner/admin -> "admin"; EVERYTHING ELSE ->
--      "developer".  So hr -> "developer".
--
--    src/app/api/invitations/accept/route.js lines 95-104 (before this change)
--      const isAdminLike = invite.role === "owner" || invite.role === "admin"
--                          || invite.role === "hr";
--      ... user_type: isAdminLike ? "admin" : ...
--      So hr -> "admin".
--
--  Same role, two answers, and the answer is written into THREE places at
--  once: `memberships.user_type`, the profile table the person's row is created
--  in, and `app_metadata.user_type` in their Supabase Auth user (accept route
--  line 190). An hr PROVISIONED through /api/auth/provision got "developer"; an
--  hr INVITED got "admin".
--
--  WHY THE LOOSE ANSWER IS THE WRONG ONE. Several routes branch on `userType`
--  rather than on `role`, and for `user_type = "admin"` those branches are
--  LOOSER than the catalogue — which puts `monitoring.view` at owner+admin:
--
--    /api/productivity      line 455  `if (auth.userType !== 'admin') -> 403`
--                           line 39   `isAdminViewer = auth.userType === 'admin'`
--    /api/keyboard-stats    line 24   `if (auth.userType === "developer")` forces
--                                     self-scoping — which an invited hr escapes
--    /api/task-submission   lines 75, 293  a non-'developer' userType may submit
--                                     as an arbitrary developer_id
--    src/middleware.ts      line 73   `s.userType === 'admin' || canEnterAdminArea(...)`
--
--  So an INVITED hr held, through the JWT claim, the org-wide monitoring access
--  that FINDING 2 is removing from RLS — by a second and completely separate
--  route. Fixing only the RLS half would have left it open.
--
--  THE FIX, AND WHY IT IS THIS DIRECTION. `userTypeForRole()` is now the single
--  source: the accept route imports it (and PROFILE_TABLE) instead of computing
--  `isAdminLike`. hr therefore resolves to "developer" everywhere, which is:
--    * what provisioning already did, so it is not a new behaviour;
--    * the TIGHTER of the two answers — it closes the loose branches above
--      rather than widening the others to match;
--    * what STAFF_ROLES already assumes (roles.js line 98 DERIVES the set of
--      roles the Employees directory can create from userTypeForRole ===
--      "developer", and hr is in it — an hr created from that screen has always
--      gone to `developers`);
--    * what tests/roleDashboards.test.js line 109 already asserted, for hr
--      among four other roles, and what sectionAccess.js lines 111-118 describe
--      as the established fact.
--  hr does not lose the admin dashboard by this: middleware.ts line 73 admits
--  /admin on `canEnterAdminArea(role)` as well as on userType, and
--  ADMIN_AREA_ROLES is derived from the catalogue, which grants hr member.view.
--
--  WHAT IT DOES NOT FIX, AND WHAT A HUMAN MUST DECIDE. The change makes NEW
--  accounts consistent. It repairs nothing already written. An hr who accepted
--  an invitation BEFORE it has:
--
--    a. a profile row in `admin_users` and NO row in `developers`;
--    b. `memberships.user_type = 'admin'`;
--    c. `app_metadata.user_type = 'admin'` in their Supabase Auth user.
--
--  and (c) is the one that grants the loose access, because that is what
--  getAuthedOrg reads. PART 1 query 1e counts them.
--
--  THE REMEDY IS DELIBERATELY NOT AUTOMATED HERE. Moving a person between
--  profile tables is not an UPDATE: `admin_users` and `developers` have
--  different columns, different foreign keys and different RLS, other rows
--  point at the old id, and getting it wrong strands a real person's login.
--  Note also that /api/auth/repair-claims line 89 copies `membership.user_type`
--  INTO the claim verbatim — it does not recompute it from the role — so
--  correcting (b) is what makes (c) correctable, and correcting (c) without (b)
--  is undone by the next claim repair. The sequence a human should follow, per
--  affected person, having first read PART 1:
--
--    1. decide whether that person should be `hr` at all, or whether they were
--       invited as hr because hr was the only way to reach the admin console;
--    2. create their `developers` row and re-point memberships.user_id at it;
--    3. set memberships.user_type = 'developer';
--    4. re-run /api/admin/members/sync-roles (or repair-claims) so the JWT
--       claim follows the membership row;
--    5. remove the orphaned `admin_users` row LAST, and only once nothing
--       references its id.
--
--  Until that is done, an existing invited hr keeps the wider access. Say so in
--  the change log; do not let this file imply otherwise.
--
--  ==========================================================================
--  WHAT THIS FILE DOES TO THE DATABASE
--  ==========================================================================
--  Creates one function and one trigger (PARTS 2 and 3). Replaces the body of
--  one existing function, signature unchanged (PART 4). Creates no table, no
--  policy and no index. Drops nothing. UPDATES NO ROW, DELETES NO ROW.
--
--  Idempotent: every statement is `create or replace function` or
--  `drop trigger if exists` + `create trigger`. Safe to run twice.
--
--  ORDERING: PART 2 must run before PART 3 (PART 3 names PART 2's function).
--  That is the safe direction — if PART 2 fails, no trigger exists and the
--  table is left exactly as 057 left it. PART 4 is independent of both.
--
--  Depends on: 014 (auth_role, auth_org, auth_is_client), 032 (the
--  `client_visible` column), 040 (the function PART 4 replaces), 057 (the
--  policy PART 2 overlays).
--  Requires PostgreSQL 11 or later for `execute function`.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - READ-ONLY pre-flight. Nothing here changes anything.
--           Run each on its own; the SQL editor shows only the last result.
-- ---------------------------------------------------------------------

--  1a. Does `client_visible` exist on THIS deployment, and is it the type PART
--      2 assumes? Expect one row: client_visible, boolean, NOT NULL, default
--      false (032 line 36).
--      If it is MISSING, PART 2 still installs and is inert — the to_jsonb
--      comparison never sees the key — but find out why before trusting it.
-- select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'developer_tasks' and column_name = 'client_visible';

--  1b. HOW MUCH IS ALREADY PUBLISHED. Run this BEFORE PART 2 and keep the
--      number. This trigger stops the flag being flipped from now on; it does
--      not un-publish anything already flipped. If this count is larger than
--      the team expects, somebody has already done it — and note 032 line 51
--      published every existing task in one statement when it ran, so a high
--      number may simply be that backfill.
-- select count(*) filter (where client_visible) as published, count(*) filter (where not client_visible) as internal, count(*) as total from public.developer_tasks;

--  1c. Existing triggers on developer_tasks, so this one is not landing beside
--      something that also writes client_visible. Triggers on the same event
--      fire in NAME order; a BEFORE UPDATE trigger sorting before
--      trg_developer_tasks_client_visibility_guard that set the flag itself
--      would be attributed to the caller. There is none in database/ today.
-- select tgname, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid = 'public.developer_tasks'::regclass and not tgisinternal order by tgname;

--  1d. WHICH DATABASE ROLES WILL PART 2 LET STRAIGHT THROUGH? This is the
--      outage question — see PART 2 step 2. Expect service_role with
--      bypasses_rls = true, postgres with is_super = true, and `authenticated`
--      and `anon` false in both columns. If service_role is false in both AND
--      is named something else on this deployment, add its real name to PART 2
--      or server-side task writes start returning 403.
-- select rolname, rolsuper as is_super, rolbypassrls as bypasses_rls from pg_roles where rolname in ('service_role','authenticated','anon','authenticator','postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin') order by rolname;

--  1e. FINDING 3, MEASURED. How many people are carrying the wrong user_type?
--      Expect ZERO rows on a deployment that has only ever provisioned staff
--      through /api/auth/provision or the Employees screen. Every row returned
--      is an `hr` who accepted an INVITATION and therefore has a profile row in
--      admin_users, memberships.user_type = 'admin', and an app_metadata claim
--      that opens /api/productivity and un-scopes /api/keyboard-stats.
--      READ THE FINDING 3 SECTION OF THIS HEADER BEFORE TOUCHING ANY OF THEM.
--      Do NOT "fix" this with an UPDATE.
-- select m.id as membership_id, m.organization_id, m.user_id, m.email, m.role, m.user_type, exists (select 1 from public.admin_users a where a.id = m.user_id) as has_admin_users_row, exists (select 1 from public.developers d where d.id = m.user_id) as has_developers_row from public.memberships m where m.role = 'hr' and m.user_type <> 'developer' order by m.organization_id, m.email;

--  1f. The same question asked of every role at once, in case another mismatch
--      exists that finding 3 did not name. The expected mapping is
--      roles.js userTypeForRole(): client -> client, owner/admin -> admin,
--      everything else -> developer. Any row returned is a disagreement.
-- select m.role, m.user_type, count(*) from public.memberships m where m.user_type is distinct from (case when m.role = 'client' then 'client' when m.role in ('owner','admin') then 'admin' else 'developer' end) group by m.role, m.user_type order by m.role;

--  1g. FINDING 2, MEASURED. Who is about to lose the monitoring surface?
--      Every row is an hr whose RLS reads collapse to their own data.
-- select organization_id, count(*) as hr_members from public.memberships where role = 'hr' and coalesce(status, 'active') = 'active' group by organization_id order by organization_id;


-- ---------------------------------------------------------------------
--  PART 2 - The client-visibility guard function
-- ---------------------------------------------------------------------
--  Read the body in the order it short-circuits; the order IS the design.
--
--   1. tg_op guard. Defensive only — PART 3 attaches this to UPDATE alone. It
--      costs nothing and keeps the function correct if someone later attaches
--      it to another event by hand.
--
--   2. THE CHANGE TEST, FIRST. Every other UPDATE on this table — a drag
--      between board columns, a status change, an estimate, a label, the
--      `updated_at` stamp pmData.js line 208 adds to every patch — returns here
--      having touched neither the JWT nor the system catalogues. This is the
--      hottest write path in the product and it must stay cheap.
--
--      THIS IS A DELIBERATE DEPARTURE FROM 048's ORDER, which puts the
--      privileged-role escape first. 048's reason for that order is that the
--      service role often has no request.jwt.claims at all, so anything
--      consulting auth_role() before the escape would be deciding on a null.
--      That reason is preserved exactly: the change test reads OLD and NEW and
--      NOTHING ELSE — no JWT, no auth_*() helper — so the escape still comes
--      before the first claim is read. 070 makes the same trade for the same
--      reason. What is NOT acceptable is moving the entitlement test up.
--
--      Comparison through to_jsonb, not `old.client_visible`, and for 048's
--      reason: plpgsql does not resolve record fields at CREATE time, so a
--      named reference on a deployment whose developer_tasks predates 032
--      would create cleanly and then raise on EVERY task update, in production.
--      `to_jsonb(old) ->> 'client_visible'` is null on both sides when the
--      column is absent, compares equal, and the guard degrades to permitting
--      exactly the column that does not exist.
--
--      `is distinct from` rather than `<>`: false -> null and null -> true are
--      both real changes, and `<>` returns null for them, and null is not true,
--      so a plain `<>` would let exactly the interesting cases through. Setting
--      the flag to the value it already holds is NOT a change and is allowed —
--      a BEFORE trigger cannot see the SET list, PostgREST fills unnamed
--      columns of NEW from OLD, so "PATCH {status}" and "PATCH
--      {client_visible: <same>}" are the same event to any trigger. Allowing
--      both is the only option that does not break case one. Nothing is
--      published by it.
--
--   3. THE PRIVILEGED-ROLE ESCAPE. RLS IS BYPASSED FOR THE SERVICE ROLE;
--      TRIGGERS ARE NOT. Every server route that writes developer_tasks —
--      /api/admin-review's status write, the automation routes, any backfill
--      run from psql, and 032 line 51's publish-everything statement were it
--      ever replayed — runs as service_role or postgres and must pass
--      unconditionally, or this file is an outage rather than a fix.
--
--      THE TEST IS THE DATABASE ROLE, NOT A JWT CLAIM. A JWT is presented by
--      the caller; a database role is assigned by the connection. PostgREST
--      issues `set local role service_role` for a service-key request and
--      `set local role authenticated` for a user request, so current_user is
--      the honest answer to "which key opened this connection" and a browser
--      session cannot forge it. The name list is checked first because it is
--      free; the pg_roles lookup behind it carries the rule, because a role
--      that already bypasses RLS on this table is not meaningfully constrained
--      by a column rule on top of it, and because it stays true on a deployment
--      whose service role has been renamed. `authenticated`, `anon` and
--      `authenticator` carry neither attribute and are in neither list, which
--      is the whole point.
--
--   4. THE ENTITLEMENT TEST, reached only when the flag really moved. DECIDERS,
--      plus the client lock. The coalesce matters: auth_role() is null when
--      there is no JWT, `null in (...)` is null, and null is not true — so a
--      session with no claims is refused rather than admitted. Fail closed.
--
--      auth_is_client() is called even though 057's policy already excludes
--      clients from UPDATE, for 048's reason: a guard that depends on another
--      file's policy for its correctness is a guard that fails the day someone
--      re-runs 013. It is the second of two locks, not the first.
--
--      The organisation is NOT re-checked here. 057's org_isolation still
--      requires `organization_id = public.auth_org()` before any row reaches
--      this trigger. Repeating it would duplicate a rule that lives in one
--      place and would silently diverge from it the day 057 is amended.
--
--   5. The refusal. 42501 is insufficient_privilege, which PostgREST maps to
--      HTTP 403; an unqualified `raise exception` carries P0001 and returns a
--      500, which reads as an outage to every monitor and tells a prober they
--      found a crash rather than a wall. The message NAMES THE COLUMN REFUSED
--      and NAMES NOBODY — no role list, no echo of the caller's role, no hint
--      that a different session would succeed.
--
--  DO NOT ADD `security definer` TO THIS FUNCTION. A security definer function
--  reports current_user as its OWNER, which on a Supabase project is postgres,
--  so step 3 would pass EVERY caller — silently, while the file still looked
--  applied. This is the single most dangerous edit that could be made to it,
--  and it is the trap 048 documents at length. It needs no elevated rights: it
--  reads OLD, NEW, pg_roles (world-readable) and two stable helpers from 014
--  that are already executable by `authenticated`.

create or replace function public.developer_tasks_guard_client_visibility()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_role       text;
  v_privileged boolean := false;
begin
  -- 1. Defensive: PART 3 attaches this to UPDATE only.
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- 2. Did the flag move? Reads OLD and NEW and nothing else.
  if (to_jsonb(old) ->> 'client_visible')
     is not distinct from (to_jsonb(new) ->> 'client_visible') then
    return new;
  end if;

  -- 3. Trusted server-side callers. Before the first JWT read.
  if current_user in ('service_role','postgres','supabase_admin',
                      'supabase_auth_admin','supabase_storage_admin') then
    return new;
  end if;
  select coalesce(bool_or(r.rolsuper or r.rolbypassrls), false)
    into v_privileged from pg_roles r where r.rolname = current_user;
  if v_privileged then
    return new;
  end if;

  -- 4. DECIDERS — permissionCatalogue.js `task.set_client_visibility`.
  v_role := public.auth_role();
  if coalesce(v_role in ('owner','admin','manager'), false)
     and not public.auth_is_client() then
    return new;
  end if;

  -- 5. Refuse. Names the column, names nobody.
  raise exception using errcode = '42501',
    message = 'permission denied: developer_tasks.client_visible may not be changed by this request',
    hint    = 'Publishing a task to the client portal is decided from the task drawer by an owner, admin or manager.';
end
$$;


-- ---------------------------------------------------------------------
--  PART 3 - Attach it (AFTER PART 2)
-- ---------------------------------------------------------------------
--  BEFORE UPDATE, FOR EACH ROW, NO `when` CLAUSE.
--
--  BEFORE rather than AFTER: a BEFORE trigger that raises aborts the statement
--  before the row is written, so nothing is rolled back and no AFTER trigger on
--  this table observes a publication that is about to be undone.
--
--  FOR EACH ROW rather than FOR EACH STATEMENT: a statement-level trigger has
--  no OLD or NEW and cannot see which columns moved.
--
--  NO `when` CLAUSE, and this is the same decision 048 PART 2 records: a
--  `when (old.client_visible is distinct from new.client_visible)` names the
--  column in the trigger DEFINITION, where PostgreSQL resolves it at CREATE
--  time — so on a deployment predating 032 the CREATE would fail outright and
--  the guard would silently not exist. That would throw away the to_jsonb
--  property PART 2 was written to have, in the last statement of the file. The
--  short-circuit a WHEN clause would buy is already PART 2 step 2, at the cost
--  of one function call per updated row.

drop trigger if exists trg_developer_tasks_client_visibility_guard on public.developer_tasks;
create trigger trg_developer_tasks_client_visibility_guard
  before update on public.developer_tasks
  for each row execute function public.developer_tasks_guard_client_visibility();


-- ---------------------------------------------------------------------
--  PART 4 - auth_monitoring_sees_all, without hr
-- ---------------------------------------------------------------------
--  ONE WORD REMOVED. Everything else about this function is 040 line 205
--  verbatim: same name, same argument list, same return type, same `language
--  sql stable`, same single-quoted body, same `not public.auth_is_client()`
--  second lock, same coalesce so a null role is not an owner.
--
--  THE SIGNATURE IS UNCHANGED ON PURPOSE. A dozen policies across 040, 044,
--  045, 046 and 047 call this function by name, and `create or replace` with an
--  identical signature rewrites the body underneath all of them in one
--  statement, with no policy dropped and no window during which a monitoring
--  table has no read policy. Do NOT be tempted to `drop function` first: the
--  drop would fail on the dependent policies, and forcing it with `cascade`
--  would DROP EVERY MONITORING READ POLICY IN THE DATABASE and leave those
--  tables readable by nobody — or, on a table where org_isolation is the only
--  other policy, by everybody.
--
--  NOT security definer, and it never was: it reads the JWT and touches no
--  table, so it needs no elevated rights. Adding it here would be pointless
--  rather than dangerous, but it would also make this function stop matching
--  the one it replaces, which is the property PART 4 exists to preserve.
--
--  This does not weaken anything. It removes one role from an OR branch; every
--  other term of every consuming policy is untouched, so owner and admin still
--  short-circuit and manager/team_lead still get their reports_to subtree
--  through auth_monitoring_subjects(). The role list here is now exactly
--  permissionCatalogue.js `monitoring.view` = ADMINS = owner, admin.

create or replace function public.auth_monitoring_sees_all() returns boolean language sql stable as 'select coalesce(public.auth_role() in (''owner'',''admin''), false) and not public.auth_is_client()';


-- =====================================================================
--  VERIFY (read-only). Run each on its own — the editor shows only the last.
-- =====================================================================

--  1. The trigger exists, is enabled (tgenabled = 'O'), and is BEFORE UPDATE
--     FOR EACH ROW.
-- select tgname, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid = 'public.developer_tasks'::regclass and not tgisinternal order by tgname;

--  2. THE GUARD FUNCTION IS SECURITY INVOKER. prosecdef MUST be false. If it is
--     true, PART 2 step 3 passes every caller and the guard is theatre. This is
--     the one check worth wiring into VERIFY_saas.sql.
-- select proname, prosecdef as is_security_definer, provolatile, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = 'developer_tasks_guard_client_visibility';

--  3. The entitled list in the INSTALLED function still matches DECIDERS in
--     src/utils/permissionCatalogue.js line 85. Expect true, true, true, false,
--     false — owner/admin/manager present, team_lead and hr absent.
-- select pg_get_functiondef(oid) like '%''owner''%' as has_owner, pg_get_functiondef(oid) like '%''admin''%' as has_admin, pg_get_functiondef(oid) like '%''manager''%' as has_manager, pg_get_functiondef(oid) like '%''team_lead''%' as has_team_lead, pg_get_functiondef(oid) like '%''hr''%' as has_hr from pg_proc where proname = 'developer_tasks_guard_client_visibility';

--  4. THE MONITORING FUNCTION NO LONGER MENTIONS hr. Expect has_hr = false,
--     has_owner = true, has_admin = true, is_security_definer = false. If
--     has_hr comes back true, PART 4 did not run, or 040 was replayed after it
--     — replay PART 4, it is safe to run at any time.
-- select pg_get_functiondef(oid) like '%''hr''%' as has_hr, pg_get_functiondef(oid) like '%''owner''%' as has_owner, pg_get_functiondef(oid) like '%''admin''%' as has_admin, prosecdef as is_security_definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = 'auth_monitoring_sees_all';

--  5. Every consuming policy is still in place and still names the function.
--     Expect one row per monitoring table plus the storage policy: nothing here
--     should have changed, and a MISSING row means a `drop ... cascade` went
--     through the warning in PART 4.
-- select schemaname, tablename, policyname, cmd from pg_policies where coalesce(qual, '') like '%auth_monitoring_sees_all%' order by schemaname, tablename, policyname;

--  6. 057's policy on developer_tasks is untouched — this file must not have
--     altered one. Expect org_isolation with cmd = 'ALL', plus
--     developer_tasks_client_read (035) with cmd = 'SELECT'.
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'developer_tasks' order by policyname;

--  7. LIVE PROOF that a developer is refused. Runs inside a transaction that
--     rolls itself back. Replace both placeholders with a real organisation and
--     a real internal task in it. Expect ERROR 42501. If it SUCCEEDS, the
--     trigger is not installed or the function is SECURITY DEFINER — go back to
--     check 2.
-- begin; set local role authenticated; set local request.jwt.claims = '{"app_metadata":{"organization_id":"REPLACE-ORG","role":"developer","user_type":"developer","app_user_id":"REPLACE-APP-USER-ID"}}'; update public.developer_tasks set client_visible = true where id = 'REPLACE-TASK-ID'; rollback;

--  8. THE MATCHING PROOF THAT THE BOARD STILL WORKS — the no-regression half,
--     and the one to run if anything looks wrong after applying this. The same
--     developer updating a NON-guarded column. Expect UPDATE 1, then rolled
--     back. If this fails, PART 2 step 2 is broken and the board is down.
-- begin; set local role authenticated; set local request.jwt.claims = '{"app_metadata":{"organization_id":"REPLACE-ORG","role":"developer","user_type":"developer","app_user_id":"REPLACE-APP-USER-ID"}}'; update public.developer_tasks set updated_at = now() where id = 'REPLACE-TASK-ID'; rollback;

--  9. And that a manager IS still allowed to publish. Expect UPDATE 1, rolled
--     back.
-- begin; set local role authenticated; set local request.jwt.claims = '{"app_metadata":{"organization_id":"REPLACE-ORG","role":"manager","user_type":"developer","app_user_id":"REPLACE-APP-USER-ID"}}'; update public.developer_tasks set client_visible = true where id = 'REPLACE-TASK-ID'; rollback;

-- 10. And that an hr session now sees only its own keyboard_stats. Expect a row
--     count no greater than that hr's own rows.
-- begin; set local role authenticated; set local request.jwt.claims = '{"app_metadata":{"organization_id":"REPLACE-ORG","role":"hr","user_type":"developer","app_user_id":"REPLACE-HR-APP-USER-ID"}}'; select count(*) from public.keyboard_stats; rollback;


-- =====================================================================
--  STILL OPEN AFTER THIS FILE - not fixed here, listed so it is not lost
-- =====================================================================
--  a. INSERT IS NOT GUARDED, AND IT IS THE SAME HOLE THROUGH A DIFFERENT DOOR.
--     This file installs a BEFORE UPDATE trigger, which is the change that was
--     specified and which closes the reported attack — flipping an EXISTING
--     internal task, with its existing title, description and comment history,
--     into the client portal. It does not stop an authenticated non-client
--     member INSERTING a new developer_tasks row with client_visible = true:
--     057's org_isolation with_check has no role term on INSERT either, and an
--     INSERT may name the column outright.
--     WHAT THAT DOES AND DOES NOT BUY, precisely, because it should not be
--     overstated: the attacker publishes a row they authored themselves, on a
--     project they can already write to. No pre-existing internal content is
--     disclosed. It is a way to put text in front of a client, which is closer
--     to the comment-insert path 033 already governs than to this finding.
--     THE FIX IS SMALL AND IS DELIBERATELY NOT SMUGGLED IN HERE: the same
--     function, attached BEFORE INSERT as well, refusing any inserted row whose
--     client_visible is not the 032 default of false unless the caller is
--     entitled. Grepped, that would affect nothing shipped — no INSERT anywhere
--     in src/ names client_visible. It is a separate decision about what a
--     legitimate non-service-role insert may look like, exactly as 048's item
--     (a) was, and it belongs in its own file.
--
--  b. milestones AND project_updates HAVE THE SAME COLUMN AND NO GUARD. 032
--     lines 37-38 add `client_visible` to both, DEFAULTING TO TRUE rather than
--     false, and the client portal reads both through it
--     (api/client/projects/[id]/timeline lines 63, 83, 145). Whether the same
--     rule should apply to them is a product question — a milestone is a
--     schedule the client is generally meant to see, which is why its default
--     is the opposite way round — and it needs its own answer rather than this
--     file's answer applied by analogy.
--
--  c. THE CLIENT-FACING READ IS STILL ONE BOOLEAN DEEP. 035's policy exposes
--     the task, and 033's exposes its non-internal comments, on the strength of
--     `client_visible = true` alone. Nothing re-checks that the client is
--     actually attached to the project at the moment of the read beyond
--     auth_client_project_ids(). That is 035's design and this file does not
--     change it; it is noted because the blast radius of ONE mis-set boolean is
--     the reason finding 1 mattered.
--
--  d. EXISTING INVITED hr ACCOUNTS ARE NOT REPAIRED. See FINDING 3 above and
--     PART 1 query 1e. The accept route no longer creates them; the ones
--     already created still carry app_metadata.user_type = 'admin' and still
--     pass /api/productivity line 455. THIS IS THE ITEM MOST LIKELY TO BE
--     FORGOTTEN, because the code fix and the test both pass while the data is
--     still wrong.
--
--  e. THE ROUTES THAT BRANCH ON user_type RATHER THAN role ARE THE DEEPER BUG.
--     /api/productivity, /api/keyboard-stats and /api/task-submission each ask
--     "is this caller user_type admin/developer" when what they mean is a
--     permission — monitoring.view, and "may this caller submit on behalf of
--     someone else". user_type is a storage detail (which profile table the row
--     is in); it was never an authorisation vocabulary, and finding 3 is what
--     happens when it is used as one. Those routes are owned elsewhere in this
--     change and are not touched here. Re-keying them onto roleCan() would make
--     finding 3 unable to recur, rather than merely fixed once.
--
--  f. REPLAYING 040 ON ITS OWN UNDOES PART 4. 040 line 205 is a `create or
--     replace` of the same function WITH hr in it. Triggers survive a replay of
--     013/014/057, but this function does not survive a replay of 040. Applying
--     database/ in file-number order is safe — 073 lands after 040 and wins —
--     but re-running 040 alone to repair a monitoring policy, which is a
--     plausible support action, silently restores hr's org-wide read. Re-run
--     PART 4 after any replay of 040. VERIFY item 4 is the check that catches
--     it, and it is cheap enough to belong in VERIFY_saas.sql.
--     The same applies to 044, 045, 046 and 047, none of which redefine this
--     function — they only call it — so replaying those is harmless.
-- =====================================================================
