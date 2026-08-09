-- =====================================================================
--  043 - Delete a team and detach its members in ONE transaction
-- =====================================================================
--  ADDITIVE ONLY. This migration creates one function and sets its grants.
--  It alters no table, no column, no policy, no trigger and no existing
--  function. Applying it changes nothing until something calls the function.
--
--  ---------------------------------------------------------------------
--  WHAT THE PROBLEM ACTUALLY IS
--  ---------------------------------------------------------------------
--  Deleting a team has two effects: every membership pointing at it is
--  detached (memberships.team_id -> null), and the teams row is removed.
--  src/components/admin/OrganizationManagement.jsx used to do that from the
--  BROWSER, as two PostgREST round-trips:
--
--    update public.memberships set team_id = null where team_id = $1;
--    delete from public.teams where id = $1;
--
--  Two round-trips are two transactions. supabase-js has no client-side
--  transaction and PostgREST gives one per request, so there is no way to roll
--  the first back when the second fails. When the delete failed - an RLS
--  refusal, a foreign key from a table nobody remembered, a dropped connection
--  - every member of that team was left detached from a team that still
--  existed, and the only repair was to re-assign them by hand, from memory,
--  one at a time. The failure was reported honestly by then, but reporting a
--  broken state is not the same as not entering it.
--
--  A function is the fix because a function body executes inside ONE
--  transaction. Called as a single top-level statement (PostgREST rpc), both
--  writes commit together or neither does. There is no intermediate state for
--  a caller, a crash, or a concurrent reader to observe.
--
--  ---------------------------------------------------------------------
--  WHY THE UPDATE IS WRITTEN OUT, GIVEN THE FOREIGN KEY ALREADY DOES IT
--  ---------------------------------------------------------------------
--  memberships.team_id is declared `references public.teams(id) on delete set
--  null` (010), so on this schema the delete alone would detach the members.
--  The update is still issued explicitly, for two reasons:
--
--   1. The behaviour must not depend on which action that constraint happens
--      to carry. If it were ever recreated as `on delete cascade` - a single
--      word, and the more common default in most people's fingers - deleting a
--      team would DELETE its members' membership rows instead of detaching
--      them. Running the update first means no membership references the team
--      by the time the delete runs, so the constraint's action is a no-op
--      whatever it is, and "delete a team" cannot quietly become "remove those
--      people from the organisation".
--
--   2. It preserves the order the application already had, and makes the
--      detach countable - the function returns how many rows it detached, so
--      the caller can report a fact instead of an assumption.
--
--  public.invitations.team_id carries the same `on delete set null` and is NOT
--  touched here: pending invitations losing their team hint is what the old
--  browser pair did too (via that constraint), and this migration changes no
--  behaviour it did not set out to change.
--
--  ---------------------------------------------------------------------
--  WHY IT IS security invoker AND EXECUTABLE BY service_role ONLY
--  ---------------------------------------------------------------------
--  PostgREST exposes every function in `public` as an rpc endpoint, and
--  EXECUTE is granted to PUBLIC by default. A `security definer` function here
--  would therefore be a deletion endpoint that bypasses RLS and takes the
--  organisation id as an ARGUMENT - any authenticated user, in any
--  organisation, could pass someone else's org id and delete their teams. That
--  is strictly worse than the bug being fixed.
--
--  So: `security invoker` (the caller's own privileges and RLS apply), EXECUTE
--  revoked from PUBLIC / anon / authenticated, and granted only to
--  service_role. The single caller is DELETE /api/admin/teams/[id], which runs
--  server-side, verifies the bearer token with getAuthedOrg(), checks the
--  caller's role, and passes the organisation id FROM THE VERIFIED TOKEN -
--  never from the request body.
--
--  The org id is still re-checked inside the function, under the row lock, so
--  the ownership test and the writes cannot be separated by a concurrent
--  update. A team that does not exist and a team belonging to another
--  organisation return the SAME answer (found=false), so the route can answer
--  404 for both and the response cannot be used to probe which team ids exist
--  elsewhere.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting - the function body is a single-quoted string on one line with
--  doubled inner quotes. No double-quoted identifiers. Run each PART as its
--  own query. Re-running the whole file is safe.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY. What the two statements look like today.
-- ---------------------------------------------------------------------
--  How many members would a delete of team X detach, and does that team belong
--  to the organisation you think it does?

-- select t.id, t.organization_id, t.name, count(m.id) as members from public.teams t left join public.memberships m on m.team_id = t.id group by t.id, t.organization_id, t.name order by members desc;

--  The constraint whose action PART 1 deliberately does not rely on.

-- select conname, confdeltype from pg_constraint where conrelid = 'public.memberships'::regclass and contype = 'f' and conname like '%team%';


-- ---------------------------------------------------------------------
--  PART 1 - The function
-- ---------------------------------------------------------------------
--  Returns jsonb, never raises for a "not found": { found: bool, detached: int }.
--
--   * `for update` locks the teams row, so a concurrent rename/move cannot slip
--     between the ownership check and the two writes.
--   * `is distinct from` rather than `<>`, so a null organization_id on either
--     side compares as "not mine" instead of evaluating to null and falling
--     through the branch.
--   * both writes carry `organization_id = p_org_id` as well, so even if the
--     lock and the check were somehow wrong the writes still cannot reach
--     another organisation's rows.
--   * `get diagnostics ... ROW_COUNT` is read immediately after the update, so
--     the count reported is that update's and not the delete's.
--
--  Dropped first so a re-run cannot collide with an earlier return type.

drop function if exists public.delete_team_with_members(uuid, uuid);
create function public.delete_team_with_members(p_org_id uuid, p_team_id uuid) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as 'declare v_org uuid; v_detached int := 0; begin if p_org_id is null or p_team_id is null then return jsonb_build_object(''found'', false, ''detached'', 0); end if; select t.organization_id into v_org from public.teams t where t.id = p_team_id for update; if not found or v_org is distinct from p_org_id then return jsonb_build_object(''found'', false, ''detached'', 0); end if; update public.memberships set team_id = null where team_id = p_team_id and organization_id = p_org_id; get diagnostics v_detached = ROW_COUNT; delete from public.teams where id = p_team_id and organization_id = p_org_id; return jsonb_build_object(''found'', true, ''detached'', v_detached); end';

comment on function public.delete_team_with_members(uuid, uuid) is 'Detach every membership from a team and delete the team, in one transaction. Returns {found,detached}. Callable by service_role only; the org id must come from a verified token, never from a request body.';


-- ---------------------------------------------------------------------
--  PART 2 - Grants
-- ---------------------------------------------------------------------
--  Revoking from PUBLIC is what actually closes the PostgREST endpoint; anon
--  and authenticated inherit from PUBLIC, so the two lines naming them are
--  belt and braces against a future grant that hands EXECUTE back to a role
--  directly. Same pattern as the table revokes in 036 and 039.

revoke all on function public.delete_team_with_members(uuid, uuid) from public;
revoke all on function public.delete_team_with_members(uuid, uuid) from anon;
revoke all on function public.delete_team_with_members(uuid, uuid) from authenticated;
grant execute on function public.delete_team_with_members(uuid, uuid) to service_role;


-- =====================================================================
--  VERIFY (read-only). Run each on its own - the editor shows only the last.
-- =====================================================================
--  1. The function exists and is NOT security definer (prosecdef = false).

-- select proname, prosecdef, pg_get_function_arguments(oid) as args from pg_proc where proname = 'delete_team_with_members';

--  2. EXECUTE is held by service_role and by the function owner (postgres, the
--     role that ran this migration) and by nobody else. anon and authenticated
--     must NOT appear - they are the two roles PostgREST will accept a request
--     as.

-- select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'delete_team_with_members' order by grantee;

--     Stated as a direct question instead. Expect f, f, t.

-- select has_function_privilege('anon', 'public.delete_team_with_members(uuid,uuid)', 'execute') as anon_can, has_function_privilege('authenticated', 'public.delete_team_with_members(uuid,uuid)', 'execute') as authenticated_can, has_function_privilege('service_role', 'public.delete_team_with_members(uuid,uuid)', 'execute') as service_role_can;

--  3. A team in another organisation is invisible: expect {"found": false, "detached": 0}
--     and no change to any row. Substitute a real team id from PART 0 and an
--     organisation id that does not own it.

-- select public.delete_team_with_members('00000000-0000-0000-0000-000000000000'::uuid, 'PUT-A-REAL-TEAM-ID-HERE'::uuid);

--  4. In the application: delete a team that has members from the Teams tab.
--     The members must still exist on the Members tab with an empty Team cell,
--     and the team must be gone.


-- =====================================================================
--  ROLLBACK, if ever needed
-- =====================================================================
--  Dropping the function makes DELETE /api/admin/teams/[id] fail closed - it
--  returns an error and writes nothing - rather than falling back to the
--  non-atomic pair. That is the intended failure mode.

-- drop function if exists public.delete_team_with_members(uuid, uuid);
