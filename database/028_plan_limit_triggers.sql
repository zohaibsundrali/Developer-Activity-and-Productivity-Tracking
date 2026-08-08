-- =====================================================================
--  028 - Plan limits enforced in the database (OPTIONAL)
-- =====================================================================
--  Seats are enforced in the API, because invitations and provisioning both
--  go through a server route. Projects and tasks do not — they are inserted
--  straight from the browser under RLS, so an application-only limit on them
--  is decorative: anyone with the anon key and a session can insert past it.
--
--  These triggers are the hard ceiling. They run inside the INSERT, so no
--  caller can get around them: not the browser, not a future route that
--  forgets the check, not a bulk import.
--
--  READ THIS BEFORE RUNNING
--   This is the one migration in the series that can BLOCK ordinary work. If a
--   limit is set wrong, project creation stops for that organization. It is
--   deliberately a separate file so it is a decision rather than a side effect.
--
--   The trigger enforces the limit of the plan an organization is SUBSCRIBED
--   to. It does not re-derive entitlement the way the application does, so a
--   lapsed trial keeps its paid ceiling here while the application already
--   applies the stricter free-plan limit. That asymmetry is intentional: the
--   trigger is a backstop against bypass, and the stricter rule is the app's.
--   Duplicating the entitlement rules in SQL would create two sources of truth
--   that could drift.
--
--   TO REMOVE: run the two drop statements in PART 3.
--
--  FORMAT NOTE: no DO blocks and no dollar quoting - the function bodies are
--  single-quoted strings on one physical line, because the target SQL editor
--  mangles both. Doubled single quotes inside a body are escaped quotes.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The check function
-- ---------------------------------------------------------------------
--  Returns the numeric limit for a resource on an organization's plan, or -1
--  for unlimited. Falls back to the free plan when an organization has no
--  subscription row, which is how every tenant predating billing is treated.
--
--  A key that is absent from a plan's `limits` jsonb, or present but not an
--  integer, ALSO falls back to the free plan. It previously resolved to -1,
--  and -1 means unlimited: forgetting to add a key to one plan removed that
--  plan's ceiling entirely, which is the opposite of what a limits column is
--  for. The parse is guarded rather than cast, because a raw ::integer on a
--  non-numeric value raises invalid_text_representation inside a BEFORE INSERT
--  trigger — that does not merely mis-set a limit, it aborts every project and
--  task insert for the organization with a bare Postgres cast error.

--  If the free plan is missing the key too there is no value left to fall back
--  to, so the result stays -1. That last resort is deliberate: a trigger that
--  guessed a number there would halt work over a seeding gap.
--
--  Parses a limits value, or returns NULL for anything that is not an integer.
--  NULL is the signal to fall back; it never propagates as a limit.
create or replace function public.plan_limit_int(val text) returns integer language sql immutable as 'select case when $1 ~ ''^\s*-?[0-9]+\s*$'' then btrim($1)::integer else null end';

create or replace function public.plan_limit_for(org uuid, resource text) returns integer language plpgsql stable security definer set search_path = public as 'declare lim integer; begin select public.plan_limit_int(p.limits->>resource) into lim from public.organization_subscriptions s join public.billing_plans p on p.code = s.plan_code where s.organization_id = org; if lim is null then select public.plan_limit_int(p.limits->>resource) into lim from public.billing_plans p where p.code = ''free''; end if; return coalesce(lim, -1); end';

create or replace function public.enforce_project_limit() returns trigger language plpgsql security definer set search_path = public as 'declare lim integer; used integer; begin if NEW.organization_id is null then return NEW; end if; lim := public.plan_limit_for(NEW.organization_id, ''projects''); if lim < 0 then return NEW; end if; select count(*) into used from public.projects where organization_id = NEW.organization_id; if used >= lim then raise exception ''PLAN_LIMIT_REACHED: projects (% of %). Upgrade the plan to add more.'', used, lim using errcode = ''P0001''; end if; return NEW; end';

create or replace function public.enforce_active_task_limit() returns trigger language plpgsql security definer set search_path = public as 'declare lim integer; used integer; begin if NEW.organization_id is null then return NEW; end if; if NEW.status is not null and NEW.status in (''completed'', ''rejected'') then return NEW; end if; lim := public.plan_limit_for(NEW.organization_id, ''active_tasks''); if lim < 0 then return NEW; end if; select count(*) into used from public.developer_tasks where organization_id = NEW.organization_id and status in (''pending'', ''in_progress'', ''awaiting_approval'', ''reviewed''); if used >= lim then raise exception ''PLAN_LIMIT_REACHED: active_tasks (% of %). Complete or close work, or upgrade the plan.'', used, lim using errcode = ''P0001''; end if; return NEW; end';


-- ---------------------------------------------------------------------
--  PART 2 - Attach the triggers
-- ---------------------------------------------------------------------
--  BEFORE INSERT only. An UPDATE must never be blocked: an organization that is
--  already over a limit has to stay able to edit, close and delete what it has.

drop trigger if exists trg_enforce_project_limit on public.projects;
create trigger trg_enforce_project_limit before insert on public.projects for each row execute function public.enforce_project_limit();

drop trigger if exists trg_enforce_active_task_limit on public.developer_tasks;
create trigger trg_enforce_active_task_limit before insert on public.developer_tasks for each row execute function public.enforce_active_task_limit();


-- ---------------------------------------------------------------------
--  PART 3 - Removal, if these ever get in the way
-- ---------------------------------------------------------------------
-- drop trigger if exists trg_enforce_project_limit on public.projects;
-- drop trigger if exists trg_enforce_active_task_limit on public.developer_tasks;


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select tgname, tgrelid::regclass as table_name from pg_trigger where tgname in ('trg_enforce_project_limit','trg_enforce_active_task_limit');
-- select public.plan_limit_for((select id from public.organizations limit 1), 'projects') as projects_limit;
