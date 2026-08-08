-- =====================================================================
--  031 - Notification UPDATE: constrain the post-image, not just the org
-- =====================================================================
--  029 narrowed who may UPDATE a notification and left what they may write to
--  it wide open. Its policy reads:
--
--    using (org and not client and (developer_id = me or assigned_developer_id
--           = me or admin_id = me::text or role in ('owner','admin')))
--    with check (organization_id = public.auth_org())
--
--  An explicit WITH CHECK REPLACES the USING default rather than adding to it,
--  so the row that comes OUT of the update was constrained by the organization
--  and by nothing else. A developer holding the anon key and their own session
--  could PATCH a notification legitimately addressed to them and rewrite it:
--
--    patch /rest/v1/notifications?id=eq.<their own row>
--    { "developer_id": "<the owner's app user id>", "read": false,
--      "title": "Payroll access request", "message": "..." }
--
--  The USING clause passes, because the row as it stands is theirs. The WITH
--  CHECK passes, because the organization did not change. The row lands in the
--  owner's notification centre, unread, saying whatever the developer typed and
--  attributed to nobody. That directly contradicts 029's own stated rule:
--  "Nothing may UPDATE another person's notification."
--
--  TWO CHANGES, because one is not enough:
--
--  1. WITH CHECK is made to match USING. This stops the row being handed away
--     outright. It is NOT sufficient on its own: the addressing is a set of OR-ed
--     columns, so an attacker who sets developer_id to the owner while LEAVING
--     assigned_developer_id pointing at themselves still satisfies it - and the
--     read policy is OR-ed too, so the owner would see the planted row.
--
--  2. A BEFORE UPDATE trigger freezes every column except `read` and `read_at`.
--     Comparing the row before and after is the only way to express "you may
--     not re-address this", and RLS has no OLD to compare against. The two
--     columns left writable are exactly the two the application writes: every
--     UPDATE in the codebase is a mark-as-read.
--
--  Owner and admin are exempt from the trigger, matching the exemption 029
--  already grants them in USING - they administer the organization, and the
--  delete/cleanup paths run as them.
--
--  029 IS NOT EDITED. It may already be applied; this replaces its policy by
--  name, which is also what makes 030 safe to run twice.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. The function body is single-quoted with doubled inner quotes, the
--  same shape 029 PART 5 uses.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The guard trigger
-- ---------------------------------------------------------------------
--  `is distinct from` rather than `<>` so that a column going to or from NULL
--  is caught; `<>` yields NULL there and the check would pass.

create or replace function public.guard_notification_update() returns trigger language plpgsql as 'begin if coalesce(public.auth_role(), '''') in (''owner'', ''admin'') then return NEW; end if; if NEW.id is distinct from OLD.id or NEW.organization_id is distinct from OLD.organization_id or NEW.developer_id is distinct from OLD.developer_id or NEW.assigned_developer_id is distinct from OLD.assigned_developer_id or NEW.admin_id is distinct from OLD.admin_id or NEW.admin_email is distinct from OLD.admin_email or NEW.title is distinct from OLD.title or NEW.message is distinct from OLD.message or NEW.type is distinct from OLD.type or NEW.category is distinct from OLD.category or NEW.task_id is distinct from OLD.task_id or NEW.project_id is distinct from OLD.project_id or NEW.submission_id is distinct from OLD.submission_id or NEW.entity_type is distinct from OLD.entity_type or NEW.entity_id is distinct from OLD.entity_id or NEW.actor_id is distinct from OLD.actor_id or NEW.dedupe_key is distinct from OLD.dedupe_key or NEW.created_at is distinct from OLD.created_at then raise exception ''A notification recipient may only mark it read'' using errcode = ''42501''; end if; return NEW; end';

drop trigger if exists trg_guard_notification_update on public.notifications;

create trigger trg_guard_notification_update before update on public.notifications for each row execute function public.guard_notification_update();


-- ---------------------------------------------------------------------
--  PART 2 - WITH CHECK made to match USING
-- ---------------------------------------------------------------------
--  Identical predicate on both sides: the row you are allowed to touch and the
--  row you are allowed to leave behind are the same row.
--
--  `admin_id = public.auth_app_user_id()::text` is carried over from 029
--  unchanged and is CORRECT: admin_id is text in this database, and the cast
--  puts the uuid-returning helper on the same type. It is repeated here rather
--  than reasoned about.

drop policy if exists notifications_update on public.notifications;

create policy notifications_update on public.notifications for update to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and (developer_id = public.auth_app_user_id() or assigned_developer_id = public.auth_app_user_id() or admin_id = public.auth_app_user_id()::text or public.auth_role() in ('owner', 'admin'))) with check (organization_id = public.auth_org() and not public.auth_is_client() and (developer_id = public.auth_app_user_id() or assigned_developer_id = public.auth_app_user_id() or admin_id = public.auth_app_user_id()::text or public.auth_role() in ('owner', 'admin')));


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_update';
-- select tgname, tgenabled from pg_trigger where tgrelid = 'public.notifications'::regclass and not tgisinternal order by tgname;
