-- Apply after storage accounting; deploy the updated desktop login together.
begin;
create table public.tracker_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  developer_id uuid not null references public.developers(id) on delete cascade,
  auth_user_id uuid not null,
  session_id uuid not null unique,
  name text not null check(length(name) between 1 and 120),
  platform text not null check(length(platform) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  revoked_at timestamptz
);
alter table public.tracker_devices enable row level security;
revoke all on public.tracker_devices from public,anon,authenticated;
grant select on public.tracker_devices to authenticated;
grant all on public.tracker_devices to service_role;
create policy tracker_devices_read on public.tracker_devices for select to authenticated
using(organization_id=public.auth_org() and (
  auth_user_id=auth.uid() or coalesce(public.auth_override('monitoring.view'),public.auth_role() in ('owner','admin'),false)
));

create or replace function public.enroll_tracker_device(p_name text,p_platform text) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare org uuid:=public.auth_org(); person uuid:=public.auth_app_user_id(); sid uuid; device_id uuid;
begin
  if auth.uid() is null or org is null or auth.jwt()->'app_metadata'->>'user_type' is distinct from 'developer'
    or not exists(select 1 from public.developers where id=person and organization_id=org) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null then raise exception 'A signed-in session is required' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 or p_platform is null or length(trim(p_platform)) not between 1 and 40 then
    raise exception 'Invalid device name or platform' using errcode='22023';
  end if;
  -- A revoked session can never enroll itself again. A fresh password login
  -- is required to establish a new session after revocation.
  insert into public.tracker_devices(organization_id,developer_id,auth_user_id,session_id,name,platform)
    values(org,person,auth.uid(),sid,trim(p_name),trim(p_platform))
    on conflict(session_id) do update set name=excluded.name,platform=excluded.platform
      where tracker_devices.revoked_at is null and tracker_devices.expires_at>now()
        and tracker_devices.auth_user_id=auth.uid() and tracker_devices.organization_id=org
        and tracker_devices.developer_id=person
    returning id into device_id;
  if device_id is null then raise exception 'Device session expired or revoked; sign in again' using errcode='42501'; end if;
  return device_id;
end; $$;

create or replace function public.revoke_tracker_device(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,public
as $$ begin
  if auth.uid() is null or public.auth_org() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  update public.tracker_devices set revoked_at=coalesce(revoked_at,now())
    where id=p_id and organization_id=public.auth_org() and (
      auth_user_id=auth.uid() or coalesce(public.auth_override('monitoring.view'),public.auth_role() in ('owner','admin'),false));
  return found;
end; $$;

create or replace function public.auth_tracker_session() returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$ select auth.uid() is not null and exists(select 1 from public.tracker_devices d
  where d.session_id::text=auth.jwt()->>'session_id' and d.auth_user_id=auth.uid()
    and d.organization_id=public.auth_org() and d.developer_id=public.auth_app_user_id()
    and d.revoked_at is null and d.expires_at>now()); $$;

create or replace function public.auth_tracker_row(p_row jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare subject_id text:=public.auth_app_user_id()::text; subject_email text:=lower(auth.jwt()->>'email');
  key text; value text; identified boolean:=false;
begin
  if not public.auth_tracker_session() or p_row->>'organization_id' is distinct from public.auth_org()::text then return false; end if;
  foreach key in array array['developer_id','user_id'] loop
    value:=nullif(p_row->>key,'');
    if value is not null then
      if value<>subject_id then return false; end if;
      identified:=true;
    end if;
  end loop;
  foreach key in array array['developer_email','user_email','email'] loop
    value:=nullif(p_row->>key,'');
    if value is not null then
      if lower(value) is distinct from subject_email then return false; end if;
      identified:=true;
    end if;
  end loop;
  return identified;
end; $$;

do $$ declare tbl text; begin
  foreach tbl in array array['productivity_sessions','keyboard_stats','mouse_activities','app_usage',
    'screenshots','developer_logins','browser_usage','developer_activities','activity_logs'] loop
    if to_regclass('public.'||tbl) is null then continue; end if;
    execute format('create policy tracker_device_insert on public.%I as restrictive for insert to authenticated with check(public.auth_tracker_row(to_jsonb(%I)))',tbl,tbl);
    execute format('create policy tracker_device_update on public.%I as restrictive for update to authenticated
      using(public.auth_tracker_row(to_jsonb(%I)) or coalesce(public.auth_override(''productivity.recalculate''),public.auth_role() in (''owner'',''admin''),false))
      with check(public.auth_tracker_row(to_jsonb(%I)) or coalesce(public.auth_override(''productivity.recalculate''),public.auth_role() in (''owner'',''admin''),false))',tbl,tbl,tbl);
  end loop;
end; $$;
-- Existing storage tenant/read policies remain in force. Capture uploads must
-- identify the current enrolled developer in their second path segment.
create policy tracker_storage_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'monitoring' or (public.auth_tracker_session() and split_part(name,'/',1)=public.auth_org()::text and split_part(name,'/',2)=public.auth_app_user_id()::text));
create policy tracker_storage_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'monitoring' or (public.auth_tracker_session() and split_part(name,'/',1)=public.auth_org()::text and split_part(name,'/',2)=public.auth_app_user_id()::text))
with check(bucket_id<>'monitoring' or (public.auth_tracker_session() and split_part(name,'/',1)=public.auth_org()::text and split_part(name,'/',2)=public.auth_app_user_id()::text));
revoke all on function public.enroll_tracker_device(text,text),public.revoke_tracker_device(uuid),public.auth_tracker_session(),public.auth_tracker_row(jsonb) from public;
grant execute on function public.enroll_tracker_device(text,text),public.revoke_tracker_device(uuid),public.auth_tracker_session(),public.auth_tracker_row(jsonb) to authenticated;
commit;
