-- Apply after production_quota_enforcement. Access windows preserve old data:
-- a later upgrade restores history. This migration performs no retention DELETE.
begin;
create or replace function app_private.plan_feature(p_org uuid, p_feature text) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app_private
as $$
  select app_private.org_unlocked(p_org) and coalesce((select features->p_feature = 'true'::jsonb
    from public.billing_plans where code = app_private.effective_plan(p_org)), false);
$$;

create or replace function public.auth_plan_feature(p_feature text) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app_private
as $$ select public.auth_org() is not null and app_private.plan_feature(public.auth_org(), p_feature); $$;
revoke all on function public.auth_plan_feature(text) from public;
grant execute on function public.auth_plan_feature(text) to authenticated;

-- Keep client identity/profile reads available for login and a useful upgrade
-- message. Portal business data is blocked, even if a client keeps an old JWT
-- or has direct PostgREST access after cancellation/downgrade.
do $$
declare tbl record;
begin
  for tbl in select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='public' and c.column_name='organization_id' and t.table_type='BASE TABLE'
      and c.table_name not in ('clients','admin_users','developers','memberships','organization_subscriptions','user_permissions')
  loop
    execute format('alter table public.%I enable row level security', tbl.table_name);
    execute format('drop policy if exists client_plan_access on public.%I', tbl.table_name);
    execute format('create policy client_plan_access on public.%I as restrictive for all to authenticated using
      (coalesce(auth.jwt()->''app_metadata''->>''user_type'' <> ''client'', false) or public.auth_plan_feature(''client_portal''))
      with check (coalesce(auth.jwt()->''app_metadata''->>''user_type'' <> ''client'', false) or public.auth_plan_feature(''client_portal''))', tbl.table_name);
  end loop;
end; $$;

-- Reading old rules would otherwise let the browser execute Free automations.
-- A restrictive policy cannot be bypassed by a forgotten permissive grant.
alter table public.automation_rules enable row level security;
drop policy if exists automation_plan_access on public.automation_rules;
create policy automation_plan_access on public.automation_rules as restrictive for all to authenticated
using (public.auth_plan_feature('automation')) with check (public.auth_plan_feature('automation'));

create or replace function app_private.enforce_automation_feature() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $$ begin
  -- Turning a rule OFF remains possible during downgrade cleanup.
  if tg_op='UPDATE' and new.enabled=false then return new; end if;
  if not app_private.plan_feature(new.organization_id,'automation') then
    raise exception 'PLAN_FEATURE_REQUIRED: automation' using errcode='P0001';
  end if;
  return new;
end; $$;
drop trigger if exists automation_feature_write on public.automation_rules;
create trigger automation_feature_write before insert or update on public.automation_rules
for each row execute function app_private.enforce_automation_feature();

create or replace function public.auth_tracking_history(p_org uuid, p_row jsonb) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app_private
as $$
declare days bigint; recorded timestamptz;
begin
  if p_org is distinct from public.auth_org() or p_org is null then return false; end if;
  days := app_private.plan_limit(p_org,'tracking_history_days');
  if days=-1 then return true; end if;
  -- Monitoring tables have historical timestamp names; use only server-stored
  -- columns, not an API caller's requested range. Unknown timestamps fail closed.
  recorded := coalesce(nullif(p_row->>'timestamp',''), nullif(p_row->>'tracked_at',''), nullif(p_row->>'start_time',''),
    nullif(p_row->>'session_start',''), nullif(p_row->>'login_time',''), nullif(p_row->>'created_at',''))::timestamptz;
  return coalesce(recorded >= now() - make_interval(days => least(days,2147483647)::integer),false);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end; $$;
revoke all on function public.auth_tracking_history(uuid,jsonb) from public;
grant execute on function public.auth_tracking_history(uuid,jsonb) to authenticated;

do $$
declare tbl text;
begin
  foreach tbl in array array['productivity_sessions','keyboard_stats','mouse_activities','app_usage',
    'screenshots','developer_logins','browser_usage','developer_activities','activity_logs']
  loop
    if to_regclass('public.'||tbl) is null then continue; end if;
    execute format('alter table public.%I enable row level security',tbl);
    execute format('drop policy if exists tracking_history_access on public.%I',tbl);
    execute format('create policy tracking_history_access on public.%I as restrictive for select to authenticated using
      (public.auth_tracking_history(organization_id,to_jsonb(%I)))',tbl,tbl);
  end loop;
end; $$;
revoke all on all functions in schema app_private from public, anon, authenticated;
commit;
