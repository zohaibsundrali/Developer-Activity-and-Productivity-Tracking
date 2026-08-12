-- =====================================================================
--  064 - reopening a project left it unable to be saved again
-- =====================================================================
--
--  A BUG IN 063, WHICH IS ALREADY APPLIED. This repairs it.
--
--  WHAT 063 GOT WRONG
--
--  tg_project_closure_guard() does two things in this order:
--
--    1. refuses a rating or feedback unless the client has signed off, and
--    2. on reopen (closed_at going from set to null), clears the sign-off and
--       the completion, because a client who approved version one has not
--       approved whatever comes next.
--
--  Both are right. Together they are not, because step 2 clears the sign-off
--  and LEAVES THE RATING BEHIND. The row that comes out of a reopen therefore
--  holds exactly the combination step 1 exists to forbid:
--
--      client_rating = 5, client_signed_off_at = null
--
--  Step 1 does not catch it on the way out — it runs before step 2 on the same
--  row, and at that moment the sign-off is still set. It catches it on the NEXT
--  update. Any next update. Reproduced on postgres:16 against the live table
--  shape:
--
--      update projects set closed_at = null    -> UPDATE 1   (reopened)
--      update projects set name = 'Site v2'    -> ERROR: A rating or feedback
--                                                 only exists once the client
--                                                 has signed off.
--
--  So a reopened project cannot be renamed, re-dated, re-assigned, moved,
--  archived or closed again. It cannot be written to at all, and the error
--  names a field nobody touched. The only way out is a manual SQL update by
--  somebody who has read this trigger.
--
--  THE FIX, AND WHAT IT COSTS
--
--  The reopen branch clears the rating and the feedback along with the
--  sign-off. That is the honest reading of the rule already written into 063:
--  the rating is the CLIENT'S, it belongs to the sign-off, and if the sign-off
--  is withdrawn the score they gave the finished thing goes with it.
--
--  It does mean a reopen discards a rating. The route writes the old values to
--  activity_logs first (see /api/projects/[id]/closure), so the number is not
--  gone, only no longer a claim about the project's present state. Keeping it
--  queryable as a rating across reopens is a closure-history table, which is a
--  separate decision and not this repair.
--
--  RUN PART 1, then PART 2, then PART 3 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The corrected guard
-- ---------------------------------------------------------------------
--  Replaced whole rather than patched, so what is running is what is read
--  here. Parts 1 and 2 of 063 are otherwise unchanged; the only difference is
--  the two assignments marked below.

create or replace function public.tg_project_closure_guard() returns trigger
  language plpgsql
as $fn$
begin
  --  A project cannot be closed before the work is finished. Without this,
  --  "closed" becomes a way to make an inconvenient project disappear from a
  --  report, and the hours already logged against it stop adding up anywhere.
  if new.closed_at is not null and new.completed_at is null then
    raise exception 'Mark the work complete before closing the project.'
      using errcode = 'check_violation';
  end if;

  --  A rating or a comment is the CLIENT'S, so it cannot exist before the
  --  client has said anything. Otherwise a five-star score can be typed in by
  --  the company that earned it.
  if (new.client_rating is not null or coalesce(btrim(new.client_feedback), '') <> '')
     and new.client_signed_off_at is null then
    raise exception 'A rating or feedback only exists once the client has signed off.'
      using errcode = 'check_violation';
  end if;

  --  Reopening is deliberate, and it clears the sign-off with it: a client who
  --  approved version one has not approved whatever comes next.
  if tg_op = 'UPDATE' and old.closed_at is not null and new.closed_at is null then
    new.client_signed_off_at := null;
    new.completed_at := null;
    --  THE FIX. Without these two the row leaves this branch holding a rating
    --  with no sign-off — the state the check above forbids — and every later
    --  update to the project fails on a field nobody touched.
    new.client_rating := null;
    new.client_feedback := null;
  end if;

  return new;
end;
$fn$;

--  The trigger itself is unchanged and still points at this function, so it is
--  not recreated. Named here only so PART 3 has something to confirm.


-- ---------------------------------------------------------------------
--  PART 2 - Repair any row already stuck
-- ---------------------------------------------------------------------
--  Rows reopened while 063 was live are sitting in the forbidden state right
--  now and cannot be saved. This clears the orphaned rating.
--
--  IT MUST RUN AFTER PART 1. The update fires the same trigger; under the old
--  function it would be refused by the very check it is repairing. Under the
--  new one the incoming rating is null, so the check passes.
--
--  Expected to affect 0 rows on this installation — no project has ever been
--  closed, so none can have been reopened. It is here because "expected" is
--  not "verified", and a repair that finds nothing costs nothing.

update public.projects
   set client_rating = null,
       client_feedback = null
 where client_signed_off_at is null
   and (client_rating is not null or coalesce(btrim(client_feedback), '') <> '');


-- ---------------------------------------------------------------------
--  PART 3 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  3a. No row is left in the forbidden state. Expect 0.
select count(*) as rows_still_stuck
from public.projects
where client_signed_off_at is null
  and (client_rating is not null or coalesce(btrim(client_feedback), '') <> '');

--  3b. The guard is still attached, and there is still only one of it.
select tgname
from pg_trigger
where tgrelid = 'public.projects'::regclass and not tgisinternal
order by tgname;

--  3c. The running function is the fixed one. Expect both lines present —
--      matched on the assignment rather than on a comment, because a comment
--      saying "clears the rating" is not code that clears the rating.
select
  pg_get_functiondef(oid) like '%new.client_rating := null%'   as clears_rating,
  pg_get_functiondef(oid) like '%new.client_feedback := null%' as clears_feedback
from pg_proc
where oid = 'public.tg_project_closure_guard()'::regprocedure;

--  3d. Nothing else moved: closure is still a thing that has not happened.
--      Expect closed = 0 on this installation.
select count(*) filter (where closed_at is not null) as closed,
       count(*) filter (where completed_at is not null) as completed,
       count(*) as total
from public.projects;
