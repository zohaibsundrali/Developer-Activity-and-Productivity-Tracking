begin;
create schema if not exists app_private;
create index if not exists tracker_devices_presence_scope_idx on public.tracker_devices(organization_id,developer_id,id);
create table public.tracker_device_presence(
 device_id uuid primary key references public.tracker_devices(id) on delete cascade,
 epoch uuid not null,stream_id uuid not null,sequence bigint not null check(sequence between 0 and 9007199254740991),
 state text not null check(state in ('tracking','paused','idle')),received_at timestamptz not null
);
alter table public.tracker_device_presence enable row level security;
revoke all on public.tracker_device_presence from public,anon,authenticated,service_role;

-- Every writer locks the enrollment row, sharing revocation's row lock. No
-- client-supplied device, organization or profile identifier is accepted.
create function app_private.lock_presence_device() returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare device uuid; org uuid:=public.auth_org(); person uuid:=public.auth_app_user_id();
begin
 if auth.uid() is null or org is null or auth.jwt()->'app_metadata'->>'user_type' is distinct from 'developer'
  or not exists(select 1 from public.memberships where organization_id=org and user_id=person and user_type='developer' and status='active')
  or not exists(select 1 from public.developers where id=person and organization_id=org) then
  raise exception 'PRESENCE_DEVICE_REQUIRED' using errcode='42501'; end if;
 select d.id into device from public.tracker_devices d
 where d.session_id::text=auth.jwt()->>'session_id' and d.auth_user_id=auth.uid()
 and d.organization_id=org and d.developer_id=person and d.revoked_at is null and d.expires_at>clock_timestamp()
 and exists(select 1 from auth.sessions s where s.id=d.session_id and s.user_id=d.auth_user_id)
 for update of d;
 if device is null then raise exception 'PRESENCE_DEVICE_REQUIRED' using errcode='42501'; end if;
 return device;
end $$;
revoke all on function app_private.lock_presence_device() from public,anon,authenticated,service_role;

create function app_private.get_tracker_presence_epoch() returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare device uuid:=app_private.lock_presence_device();
begin return jsonb_build_object('epoch',(select epoch from public.tracker_device_presence where device_id=device)); end $$;

create function app_private.start_tracker_presence_stream(p_expected_epoch uuid,p_stream_id uuid,p_state text) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare device uuid; row public.tracker_device_presence%rowtype;
begin
 if p_stream_id is null or p_state is null or p_state not in ('tracking','paused','idle') then raise exception 'PRESENCE_INVALID' using errcode='22023'; end if;
 device:=app_private.lock_presence_device();
 select * into row from public.tracker_device_presence where device_id=device;
 if row.stream_id is distinct from p_stream_id then
  if row.epoch is distinct from p_expected_epoch then raise exception 'PRESENCE_STREAM_STALE' using errcode='40001'; end if;
  insert into public.tracker_device_presence(device_id,epoch,stream_id,sequence,state,received_at)
   values(device,gen_random_uuid(),p_stream_id,0,p_state,clock_timestamp())
   on conflict(device_id) do update set epoch=excluded.epoch,stream_id=excluded.stream_id,sequence=0,state=excluded.state,received_at=excluded.received_at
   returning * into row;
 end if;
 return jsonb_build_object('epoch',row.epoch,'sequence',row.sequence,'state',row.state,'received_at',row.received_at);
end $$;

create function app_private.heartbeat_tracker_presence(p_epoch uuid,p_sequence bigint,p_state text) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare device uuid; row public.tracker_device_presence%rowtype;
begin
 if p_epoch is null or p_sequence is null or p_sequence<1 or p_sequence>9007199254740991 or p_state is null or p_state not in ('tracking','paused','idle') then raise exception 'PRESENCE_INVALID' using errcode='22023'; end if;
 device:=app_private.lock_presence_device();
 select * into row from public.tracker_device_presence where device_id=device;
 if row.epoch is distinct from p_epoch then raise exception 'PRESENCE_STREAM_STALE' using errcode='40001'; end if;
 if p_sequence<=row.sequence then raise exception 'PRESENCE_SEQUENCE_STALE' using errcode='40001'; end if;
 update public.tracker_device_presence set sequence=p_sequence,state=p_state,received_at=clock_timestamp() where device_id=device returning * into row;
 return jsonb_build_object('epoch',row.epoch,'sequence',row.sequence,'state',row.state,'received_at',row.received_at);
end $$;

-- This deliberately exposes only safe presence metadata, never Auth IDs,
-- JWT session IDs, stream nonces or mutation epochs. Existing enrollment RLS
-- and enrollment/revocation functions remain unchanged.
create function app_private.monitoring_tracker_presence(p_organization_id uuid,p_developer_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_organization_id is null or p_developer_id is null then raise exception 'PRESENCE_INVALID' using errcode='22023'; end if;
 if p_organization_id is distinct from public.auth_org() or not coalesce(public.auth_monitoring_record_read(p_organization_id,'{}'::jsonb),false) then raise exception 'PRESENCE_FORBIDDEN' using errcode='42501'; end if;
 with scoped as materialized (
  select d.id,d.name,d.platform,d.expires_at,d.revoked_at,case when exists(select 1 from auth.sessions s where s.id=d.session_id and s.user_id=d.auth_user_id)
    and exists(select 1 from public.memberships m where m.organization_id=d.organization_id and m.user_id=d.developer_id and m.user_type='developer' and m.status='active')
    then p.state else null end state,
   case when exists(select 1 from auth.sessions s where s.id=d.session_id and s.user_id=d.auth_user_id)
    and exists(select 1 from public.memberships m where m.organization_id=d.organization_id and m.user_id=d.developer_id and m.user_type='developer' and m.status='active')
    then p.received_at else null end last_seen_at
  from public.tracker_devices d left join public.tracker_device_presence p on p.device_id=d.id
  where d.organization_id=p_organization_id and d.developer_id=p_developer_id
 ), page as (select * from scoped order by last_seen_at desc nulls last,id desc limit 100)
 select jsonb_build_object('organization_id',p_organization_id,'developer_id',p_developer_id,'server_now',statement_timestamp(),'freshness_seconds',90,
  'devices',coalesce((select jsonb_agg(to_jsonb(page) order by last_seen_at desc nulls last,id desc) from page),'[]'::jsonb),
  'total',(select count(*) from scoped),'truncated',(select count(*)>100 from scoped)) into result;
 return result||jsonb_build_object('server_now',clock_timestamp());
end $$;
revoke all on function app_private.get_tracker_presence_epoch(),app_private.start_tracker_presence_stream(uuid,uuid,text),app_private.heartbeat_tracker_presence(uuid,bigint,text),app_private.monitoring_tracker_presence(uuid,uuid) from public,anon,authenticated,service_role;
grant usage on schema app_private to authenticated;
grant execute on function app_private.get_tracker_presence_epoch(),app_private.start_tracker_presence_stream(uuid,uuid,text),app_private.heartbeat_tracker_presence(uuid,bigint,text),app_private.monitoring_tracker_presence(uuid,uuid) to authenticated;
create function public.get_tracker_presence_epoch() returns jsonb language sql volatile security invoker set search_path=pg_catalog as $$ select app_private.get_tracker_presence_epoch() $$;
create function public.start_tracker_presence_stream(p_expected_epoch uuid,p_stream_id uuid,p_state text) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $$ select app_private.start_tracker_presence_stream(p_expected_epoch,p_stream_id,p_state) $$;
create function public.heartbeat_tracker_presence(p_epoch uuid,p_sequence bigint,p_state text) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $$ select app_private.heartbeat_tracker_presence(p_epoch,p_sequence,p_state) $$;
create function public.monitoring_tracker_presence(p_organization_id uuid,p_developer_id uuid) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$ select app_private.monitoring_tracker_presence(p_organization_id,p_developer_id) $$;
revoke all on function public.get_tracker_presence_epoch(),public.start_tracker_presence_stream(uuid,uuid,text),public.heartbeat_tracker_presence(uuid,bigint,text),public.monitoring_tracker_presence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_tracker_presence_epoch(),public.start_tracker_presence_stream(uuid,uuid,text),public.heartbeat_tracker_presence(uuid,bigint,text),public.monitoring_tracker_presence(uuid,uuid) to authenticated;
commit;
