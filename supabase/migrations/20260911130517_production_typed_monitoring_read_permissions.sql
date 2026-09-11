begin;
-- Match monitoring.view / monitoring.view_own only on monitoring resources.
-- Shared hierarchy helpers also gate task/review/timesheet resources and remain
-- untouched. Managers/HR need an explicit wide monitoring grant from now on.
create or replace function public.auth_monitoring_record_read(p_org uuid,p_row jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.auth_app_user_id(); profile text:=auth.jwt()->'app_metadata'->>'user_type';
 member_role text; field text; value text; has_id boolean:=false; has_email boolean:=false;
 matched integer; matching_actor integer;
begin
 if p_org is null or p_org is distinct from public.auth_org() or profile not in ('admin','developer') then return false; end if;
 select m.role into member_role from public.memberships m where m.organization_id=p_org and m.user_id=actor and m.user_type=profile and m.status='active';
 if member_role is null or member_role='client' then return false; end if;
 if coalesce(public.auth_override('monitoring.view'),member_role in ('owner','admin'),false) then return true; end if;
 if profile<>'developer' or not coalesce(public.auth_override('monitoring.view_own'),member_role in
  ('owner','admin','manager','team_lead','hr','qa','developer','designer','devops','employee','finance'),false) then return false; end if;
 if nullif(p_row->>'user_type','') is not null and p_row->>'user_type'<>'developer' then return false; end if;
 foreach field in array array['developer_id','user_id','employee_id','member_id','dev_id'] loop
  value:=nullif(btrim(p_row->>field),'');
  if value is not null then
   has_id:=true;
   if public.try_uuid(value) is distinct from actor then return false; end if;
  end if;
 end loop;
 -- A populated authoritative ID cannot be overridden by an email OR match.
 if has_id then return true; end if;
 foreach field in array array['developer_email','user_email','email','user_login','login_email'] loop
  value:=nullif(lower(btrim(p_row->>field)),'');
  if value is not null then
   has_email:=true;
   select count(*),count(*) filter(where m.user_id=actor and m.user_type='developer') into matched,matching_actor
   from public.memberships m where m.organization_id=p_org and lower(btrim(m.email))=value;
   if matched<>1 or matching_actor<>1 then return false; end if;
  end if;
 end loop;
 return has_email;
end $$;
revoke all on function public.auth_monitoring_record_read(uuid,jsonb) from public,anon;
grant execute on function public.auth_monitoring_record_read(uuid,jsonb) to authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['productivity_sessions','keyboard_stats','mouse_activities','app_usage','screenshots','developer_logins','browser_usage','developer_activities','activity_logs'] loop
  if to_regclass('public.'||tbl) is null then continue; end if;
  execute format('alter table public.%I enable row level security',tbl);
  execute format('drop policy if exists track_read on public.%I',tbl);
  execute format('drop policy if exists activity_logs_read on public.%I',tbl);
  execute format('create policy monitoring_permission_read on public.%I for select to authenticated using(public.auth_monitoring_record_read(organization_id,to_jsonb(%I)))',tbl,tbl);
  execute format('create policy monitoring_permission_guard on public.%I as restrictive for select to authenticated using(public.auth_monitoring_record_read(organization_id,to_jsonb(%I)))',tbl,tbl);
 end loop;
end $$;
-- Public object downloads bypass RLS entirely. Operator must keep this bucket
-- private (the original019 migration already creates it private).
do $$ begin if exists(select 1 from storage.buckets where id='monitoring' and public) then
 raise exception 'Set monitoring bucket Public OFF using Storage settings before applying monitoring permissions'; end if; end $$;
create or replace function public.auth_monitoring_object_read(p_name text,p_created timestamptz)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select public.auth_monitoring_record_read(public.try_uuid(split_part(p_name,'/',1)),jsonb_build_object('developer_id',split_part(p_name,'/',2)))
 and public.auth_tracking_history(public.try_uuid(split_part(p_name,'/',1)),jsonb_build_object('created_at',p_created));
$$;
revoke all on function public.auth_monitoring_object_read(text,timestamptz) from public,anon;
grant execute on function public.auth_monitoring_object_read(text,timestamptz) to authenticated;
drop policy if exists monitoring_read on storage.objects;
create policy monitoring_read on storage.objects for select to authenticated
 using(bucket_id='monitoring' and public.auth_monitoring_object_read(name,created_at));
create policy monitoring_permission_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'monitoring' or public.auth_monitoring_object_read(name,created_at));
commit;
