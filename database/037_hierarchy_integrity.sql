-- =====================================================================
--  037 - Reporting hierarchy integrity: memberships.reports_to cannot cycle
-- =====================================================================
--  015 added `memberships.reports_to uuid` as a loose reference to another
--  member's user_id (loose, because staff live in two tables - admin_users and
--  developers - so a real FK was never available). Nothing has ever stopped
--  that pointer from closing a loop:
--
--    A reports to B, B reports to A                (two-node cycle)
--    A reports to B, B reports to C, C reports to A (longer cycle)
--    A reports to A                                 (self-reference)
--
--  Any code that walks the chain - an org chart, an approval ladder, a
--  "notify my manager" rule, a "who rolls up to me" report - follows
--  reports_to until it runs out. A cycle means it never runs out: the walk
--  loops forever, or recurses until the stack blows.
--
--  The UI is not the only writer. EmployeeProfileEditor sends the patch
--  through saveEmployee(), but OrganizationManagement.jsx updates memberships
--  straight from the browser with the anon key, and anyone holding that key
--  and a session can do the same by hand. So the guard belongs in the
--  database, where every writer goes through it. The client-side check added
--  alongside this migration exists only to turn the refusal into a sentence a
--  human can read - it is not the enforcement.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting - the target SQL editor mangles all three, so the function body
--  below is a single-quoted string on one line with its inner quotes doubled.
--  The editor also shows only the LAST statement's result, so run each PART as
--  its own query.
--
--  Depends on: 010 (memberships), 015 (memberships.reports_to).
--  Touches no other table, no policy, and no existing row.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY. Does the data already contain a cycle?
-- ---------------------------------------------------------------------
--  Run this FIRST, on its own, before PART 3 installs the trigger.
--
--  The trigger added below only judges the row being written; it deliberately
--  does not touch rows that are already stored. That is the right call - a
--  migration that silently rewrites who reports to whom is a migration that
--  quietly reorganises someone's company - but it means a cycle that already
--  exists survives this migration and keeps breaking hierarchy walks. Worse,
--  once the trigger is live, any later edit to a row inside that cycle is
--  refused, which looks like the trigger is broken when it is the data.
--
--  So: look before you install. Every row this returns is a member sitting on
--  a reporting loop. Fix them by hand (set reports_to to the correct manager,
--  or to null) - this migration will not do it for you.
--
--  Empty result = no pre-existing cycle, nothing to do.
--
--  The walk is capped at 64 hops for the same reason the trigger is: a
--  recursive CTE over cyclic data does not terminate on its own.

with recursive walk as (select m.organization_id as org_id, m.user_id as member_user_id, m.reports_to as cursor_user_id, 1 as hops, coalesce(m.reports_to = m.user_id, false) as closed_loop from public.memberships m where m.reports_to is not null union all select w.org_id, w.member_user_id, p.reports_to, w.hops + 1, coalesce(p.reports_to = w.member_user_id, false) from walk w join public.memberships p on p.user_id = w.cursor_user_id and p.organization_id is not distinct from w.org_id where w.cursor_user_id is not null and w.closed_loop = false and w.hops < 64) select org_id as organization_id, member_user_id as user_id_on_a_cycle, hops as cycle_length from walk where closed_loop = true order by org_id, hops, member_user_id;


-- ---------------------------------------------------------------------
--  PART 1 - The index the walk needs (created BEFORE anything reads it)
-- ---------------------------------------------------------------------
--  Both the trigger and PART 0 step upward with
--    where user_id = <cursor> and organization_id = <org>
--  once per level. 010 indexes (user_id, user_type), which already serves the
--  lookup, but this one matches the predicate exactly and keeps the per-hop
--  cost at an index probe instead of leaning on a prefix. Every membership
--  write now pays for one walk, so the walk has to be cheap.

create index if not exists idx_memberships_org_user on public.memberships(organization_id, user_id);


-- ---------------------------------------------------------------------
--  PART 2 - The guard function (created BEFORE the trigger that calls it)
-- ---------------------------------------------------------------------
--  Walks up from the PROPOSED manager and refuses the write if the walk
--  reaches the row being written. Four things worth knowing:
--
--  1. It returns early on an UPDATE that leaves reports_to (and user_id)
--     alone. Renaming someone, moving their team, suspending them - none of
--     that can create a cycle, so none of it pays for a walk, and none of it
--     is refused just because the person happens to sit in a chain that is
--     already bad. Only a write that actually moves the pointer is judged.
--
--  2. The walk is bounded at 64 hops. Without the bound, a cycle already in
--     the data would make the trigger itself loop forever, which turns a data
--     problem into a hung connection and a stuck table. 64 is far past any
--     real org chart, so hitting it means the data is broken, and saying so is
--     more useful than spinning.
--
--  3. The row being written is excluded from the walk by id. On an UPDATE the
--     stored copy of that row still holds the OLD reports_to; reading it would
--     judge the write against a value the write is replacing.
--
--  4. security definer, so the walk sees the whole chain. Under RLS the
--     caller's own SELECT on memberships is filtered, and a walk that cannot
--     see the rows above it would find no cycle and wave everything through -
--     a guard that fails open is worse than no guard, because it is believed.
--     The function only reads reports_to and raises; the ids in the message
--     are the two the caller just supplied, so nothing new is disclosed.
--
--  errcode 23514 is check_violation, so PostgREST reports it as a constraint
--  failure rather than a 500.

create or replace function public.memberships_reject_reporting_cycle() returns trigger language plpgsql security definer set search_path = public, pg_temp as 'declare v_cur uuid; v_hops int := 0; begin if NEW.user_id is null then return NEW; end if; if TG_OP = ''UPDATE'' and NEW.reports_to is not distinct from OLD.reports_to and NEW.user_id is not distinct from OLD.user_id then return NEW; end if; if NEW.reports_to is null then return NEW; end if; if NEW.reports_to = NEW.user_id then raise exception ''Reporting cycle refused: a member cannot report to themselves (user_id %)'', NEW.user_id using errcode = ''23514''; end if; v_cur := NEW.reports_to; while v_cur is not null loop if v_cur = NEW.user_id then raise exception ''Reporting cycle refused: % already reports to % directly or indirectly, so % cannot report to %'', NEW.reports_to, NEW.user_id, NEW.user_id, NEW.reports_to using errcode = ''23514''; end if; v_hops := v_hops + 1; if v_hops > 64 then raise exception ''Reporting chain above % is deeper than 64 levels, or the stored data already contains a cycle - refusing the write'', NEW.user_id using errcode = ''23514''; end if; select m.reports_to into v_cur from public.memberships m where m.user_id = v_cur and m.organization_id is not distinct from NEW.organization_id and m.id is distinct from NEW.id limit 1; end loop; return NEW; end';


-- ---------------------------------------------------------------------
--  PART 3 - The trigger (installed AFTER the function it executes)
-- ---------------------------------------------------------------------
--  BEFORE INSERT OR UPDATE, one trigger for both, because the two share every
--  rule; the UPDATE-only early return lives inside the function where OLD is
--  available. FOR EACH ROW - the check is about one row's pointer.
--
--  Dropped first so re-running this file is safe.

drop trigger if exists trg_memberships_no_reporting_cycle on public.memberships;
create trigger trg_memberships_no_reporting_cycle before insert or update on public.memberships for each row execute function public.memberships_reject_reporting_cycle();


-- =====================================================================
--  VERIFY (read-only). Run each on its own - the editor shows only the last.
-- =====================================================================
-- select tgname, tgenabled from pg_trigger where tgrelid = 'public.memberships'::regclass and not tgisinternal;
-- select proname, prosecdef from pg_proc where proname = 'memberships_reject_reporting_cycle';
-- select indexname from pg_indexes where schemaname = 'public' and indexname = 'idx_memberships_org_user';
-- Re-run PART 0 after fixing any rows it reported; it should come back empty.
