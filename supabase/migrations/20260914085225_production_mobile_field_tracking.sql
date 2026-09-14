begin;
create table public.work_sites (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100), latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180), radius_m integer not null check(radius_m between 100 and 10000),
 active boolean not null default true, version integer not null check(version>0), updated_at timestamptz not null default now()
);
create index work_sites_org on public.work_sites(organization_id,id);
create table public.mobile_work_sessions (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null,
 user_type text not null check(user_type in ('admin','developer')), started_at timestamptz not null, ended_at timestamptz not null,
 work_seconds integer not null check(work_seconds>0), payload jsonb not null, uploaded_at timestamptz not null default now()
);
create index mobile_work_sessions_org_date on public.mobile_work_sessions(organization_id,started_at,id);
create index mobile_work_sessions_person_date on public.mobile_work_sessions(organization_id,user_type,user_id,started_at,id);
alter table public.work_sites enable row level security;
alter table public.mobile_work_sessions enable row level security;
revoke all on public.work_sites,public.mobile_work_sessions from public,anon,authenticated;
grant select on public.work_sites,public.mobile_work_sessions to authenticated;
-- GPS history is more sensitive than attendance totals. Wide reads require both.
create function public.auth_mobile_history_all() returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select public.auth_attendance_permission('attendance.view_all') and coalesce(public.auth_override('monitoring.view'),public.auth_role() in ('owner','admin'),false);
$$;
revoke all on function public.auth_mobile_history_all() from public,anon;
grant execute on function public.auth_mobile_history_all() to authenticated;
create policy work_sites_read on public.work_sites for select to authenticated using(organization_id=(select public.auth_org()) and ((select public.auth_attendance_permission('attendance.view_own')) or (select public.auth_attendance_permission('attendance.view_all'))));
create policy mobile_work_sessions_read on public.mobile_work_sessions for select to authenticated using(organization_id=(select public.auth_org()) and ((select public.auth_mobile_history_all())
 or (user_id=(select public.auth_app_user_id()) and user_type=(select auth.jwt()->'app_metadata'->>'user_type') and (select public.auth_attendance_permission('attendance.view_own')))));
create function app_private.save_work_site(p_id uuid,p_version integer,p_name text,p_lat double precision,p_lon double precision,p_radius integer,p_active boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); previous public.work_sites%rowtype; saved public.work_sites%rowtype;
begin
 if auth.uid() is null or org is null or not coalesce(public.auth_attendance_permission('attendance.manage'),false) or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then raise exception 'MOBILE_FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_version is null or p_version<0 or p_version>=2147483647 or p_name is null or length(btrim(p_name)) not between 1 and 100
 or p_lat is null or not(p_lat between -90 and 90) or p_lon is null or not(p_lon between -180 and 180) or p_radius is null or p_radius not between 100 and 10000 or p_active is null then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not coalesce(public.auth_attendance_permission('attendance.manage'),false) or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then raise exception 'MOBILE_FORBIDDEN' using errcode='42501'; end if;
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED'; end if;
 select * into previous from public.work_sites where id=p_id and organization_id=org for update;
 if found then
  if previous.version=p_version+1 and row(previous.name,previous.latitude,previous.longitude,previous.radius_m,previous.active) is not distinct from row(btrim(p_name),p_lat,p_lon,p_radius,p_active) then return to_jsonb(previous); end if;
  if previous.version<>p_version then raise exception 'MOBILE_STALE' using errcode='40001'; end if;
  update public.work_sites set name=btrim(p_name),latitude=p_lat,longitude=p_lon,radius_m=p_radius,active=p_active,version=p_version+1,updated_at=clock_timestamp() where id=p_id and organization_id=org returning * into saved;
 else
  if p_version<>0 then raise exception 'MOBILE_STALE' using errcode='40001'; end if;
  if (select count(*) from public.work_sites where organization_id=org)>=100 then raise exception 'MOBILE_SITE_LIMIT' using errcode='54000'; end if;
  insert into public.work_sites(id,organization_id,name,latitude,longitude,radius_m,active,version)
  values(p_id,org,btrim(p_name),p_lat,p_lon,p_radius,p_active,p_version+1) returning * into saved;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function app_private.save_work_site(uuid,integer,text,double precision,double precision,integer,boolean) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.save_work_site(uuid,integer,text,double precision,double precision,integer,boolean) to authenticated;
create function public.save_work_site(p_id uuid,p_version integer,p_name text,p_lat double precision,p_lon double precision,p_radius integer,p_active boolean) returns jsonb language sql security invoker set search_path=pg_catalog,public,app_private as $$select app_private.save_work_site(p_id,p_version,p_name,p_lat,p_lon,p_radius,p_active);$$;
revoke all on function public.save_work_site(uuid,integer,text,double precision,double precision,integer,boolean) from public,anon;
grant execute on function public.save_work_site(uuid,integer,text,double precision,double precision,integer,boolean) to authenticated;
create function app_private.upload_mobile_work(p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; sid uuid; prior public.mobile_work_sessions%rowtype;
 seg jsonb; point jsonb; first_at timestamptz; last_at timestamptz; begin_at timestamptz; end_at timestamptz; point_at timestamptz; previous_point timestamptz; total integer:=0; seconds integer; log_id uuid; span_start timestamptz; span_end timestamptz; part_seconds integer; allocated integer; part_id uuid; stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or org is null or actor is null or kind is null or kind not in ('admin','developer') or not coalesce(public.auth_timesheet_permission('timesheet.log_own'),false) or not coalesce(public.auth_attendance_permission('attendance.view_own'),false) then raise exception 'MOBILE_FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1000000
 or jsonb_typeof(p_payload->'id') is distinct from 'string' or (p_payload->>'id')!~'^[0-9a-fA-F-]{36}$'
 or jsonb_typeof(p_payload->'segments') is distinct from 'array' or jsonb_array_length(p_payload->'segments') not between 1 and 100
 or jsonb_typeof(p_payload->'points') is distinct from 'array' or jsonb_array_length(p_payload->'points')>2000
 or jsonb_typeof(p_payload->'recovered') is distinct from 'boolean'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','segments','points','recovered')) then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
 sid:=(p_payload->>'id')::uuid;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not coalesce(public.auth_timesheet_permission('timesheet.log_own'),false) or not coalesce(public.auth_attendance_permission('attendance.view_own'),false) then raise exception 'MOBILE_FORBIDDEN' using errcode='42501'; end if;
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED'; end if;
 select * into prior from public.mobile_work_sessions where id=sid for update;
 if found then
  if prior.organization_id<>org or prior.user_id<>actor or prior.user_type<>kind then raise exception 'MOBILE_FORBIDDEN' using errcode='42501'; end if;
  if prior.payload is distinct from p_payload then raise exception 'MOBILE_REPLAY_MISMATCH' using errcode='40001'; end if;
  return jsonb_build_object('id',sid,'organization_id',org,'user_id',actor,'user_type',kind,'work_seconds',prior.work_seconds,'unchanged',true);
 end if;
 for seg in select value from jsonb_array_elements(p_payload->'segments') loop
  if jsonb_typeof(seg) is distinct from 'object' or jsonb_typeof(seg->'id') is distinct from 'string' or jsonb_typeof(seg->'start') is distinct from 'string' or jsonb_typeof(seg->'end') is distinct from 'string'
   or (seg->>'start')!~'^\d{4}-\d{2}-\d{2}T.*Z$' or (seg->>'end')!~'^\d{4}-\d{2}-\d{2}T.*Z$'
   or exists(select 1 from jsonb_object_keys(seg) k where k not in ('id','start','end')) then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
  log_id:=(seg->>'id')::uuid; begin_at:=(seg->>'start')::timestamptz; end_at:=(seg->>'end')::timestamptz;
  if not isfinite(begin_at) or not isfinite(end_at) or begin_at<stamp-interval '7 days' or end_at>stamp+interval '2 minutes' or end_at-begin_at<interval '1 second'
   or (last_at is not null and begin_at<last_at) then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
  first_at:=coalesce(first_at,begin_at); last_at:=end_at;
  if last_at-first_at>interval '24 hours' then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
  seconds:=floor(extract(epoch from end_at-begin_at)); total:=total+seconds;
  if exists(select 1 from public.task_time_logs l where l.organization_id=org and l.developer_id=actor and l.user_type=kind and l.started_at<end_at and coalesce(l.ended_at,'infinity'::timestamptz)>begin_at) then raise exception 'MOBILE_TIME_OVERLAP' using errcode='23P01'; end if;
  -- Timesheets are UTC Monday weeks. Split a segment at each week boundary,
  -- retaining its exact integer-second total and enforcing each week's lock.
  span_start:=begin_at; allocated:=0;
  while span_start<end_at loop
   span_end:=least(end_at,(date_trunc('week',span_start at time zone 'UTC')+interval '7 days') at time zone 'UTC');
   part_seconds:=case when span_end=end_at then seconds-allocated else floor(extract(epoch from span_end-span_start))::integer end;
   part_id:=case when span_start=begin_at then log_id else md5('mobile:'||log_id::text||':'||extract(epoch from span_start)::text)::uuid end;
   insert into public.task_time_logs(id,organization_id,developer_id,user_type,started_at,ended_at,seconds,is_billable,source)
   values(part_id,org,actor,kind,span_start,span_end,part_seconds,false,'mobile_timer');
   allocated:=allocated+part_seconds; span_start:=span_end;
  end loop;
 end loop;
 for point in select value from jsonb_array_elements(p_payload->'points') loop
  if jsonb_typeof(point) is distinct from 'object' or jsonb_typeof(point->'at') is distinct from 'string' or (point->>'at')!~'^\d{4}-\d{2}-\d{2}T.*Z$'
   or jsonb_typeof(point->'lat') is distinct from 'number' or jsonb_typeof(point->'lon') is distinct from 'number' or jsonb_typeof(point->'accuracy') is distinct from 'number' or jsonb_typeof(point->'mock') is distinct from 'boolean'
   or not((point->>'lat')::double precision between -90 and 90) or not((point->>'lon')::double precision between -180 and 180) or not((point->>'accuracy')::double precision between 0 and 10000)
   or exists(select 1 from jsonb_object_keys(point) k where k not in ('at','lat','lon','accuracy','mock')) then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
  point_at:=(point->>'at')::timestamptz;
  if not isfinite(point_at) or (previous_point is not null and point_at<=previous_point) or not exists(select 1 from jsonb_array_elements(p_payload->'segments') s where point_at between (s->>'start')::timestamptz and (s->>'end')::timestamptz) then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023'; end if;
  previous_point:=point_at;
 end loop;
 insert into public.mobile_work_sessions(id,organization_id,user_id,user_type,started_at,ended_at,work_seconds,payload) values(sid,org,actor,kind,first_at,last_at,total,p_payload);
 return jsonb_build_object('id',sid,'organization_id',org,'user_id',actor,'user_type',kind,'work_seconds',total,'unchanged',false);
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then raise exception 'MOBILE_INPUT_INVALID' using errcode='22023';
end $$;
revoke all on function app_private.upload_mobile_work(jsonb) from public,anon;
grant execute on function app_private.upload_mobile_work(jsonb) to authenticated;
create function public.upload_mobile_work(p_payload jsonb) returns jsonb language sql security invoker set search_path=pg_catalog,public,app_private as $$select app_private.upload_mobile_work(p_payload);$$;
revoke all on function public.upload_mobile_work(jsonb) from public,anon;
grant execute on function public.upload_mobile_work(jsonb) to authenticated;
create function public.mobile_work_context() returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare org uuid:=public.auth_org(); sites jsonb;
begin
 if auth.uid() is null or org is null or not (coalesce(public.auth_attendance_permission('attendance.view_own'),false) or coalesce(public.auth_mobile_history_all(),false)) then raise exception 'MOBILE_FORBIDDEN' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into sites from public.work_sites s where s.organization_id=org;
 return jsonb_build_object('organization_id',org,'user_id',public.auth_app_user_id(),'user_type',auth.jwt()->'app_metadata'->>'user_type','sites',sites,
  'can_manage',coalesce(public.auth_attendance_permission('attendance.manage'),false) and coalesce(public.auth_attendance_permission('attendance.view_all'),false),
  'can_view_all',coalesce(public.auth_mobile_history_all(),false),'can_record',coalesce(public.auth_timesheet_permission('timesheet.log_own'),false) and coalesce(public.auth_attendance_permission('attendance.view_own'),false));
end$$;
revoke all on function public.mobile_work_context() from public,anon;
grant execute on function public.mobile_work_context() to authenticated;
create or replace function public.sweep_tracking_retention(p_org uuid,p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare cutoff timestamptz; tbl text; row_data jsonb; obj record; n integer:=0; queued integer:=0; skipped integer:=0; matches integer; refs integer;
begin
 if p_limit not between 1 and 500 or p_limit is null then raise exception 'Invalid retention batch size' using errcode='22023'; end if;
 perform 1 from public.organizations where id=p_org and status='active' for update;
 if not found or app_private.organization_deleting(p_org) then return jsonb_build_object('deleted',0,'queued',0,'skipped',0); end if;
 update public.tracking_retention_policies set last_swept_at=now() where organization_id=p_org;
 cutoff:=app_private.retention_cutoff(p_org);
 if cutoff is null then return jsonb_build_object('deleted',0,'queued',0,'skipped',0); end if;
 -- Mobile GPS/session telemetry follows the same policy; approved time logs
 -- have no cascade relationship and remain as business records.
 delete from public.mobile_work_sessions where id in (
  select id from public.mobile_work_sessions where organization_id=p_org and ended_at<cutoff order by ended_at,id limit p_limit for update skip locked
 );
 get diagnostics n=row_count;
 -- Audit logs, submissions, projects, HR and financial records are NOT telemetry.
 foreach tbl in array array['keyboard_stats','mouse_activities','app_usage','browser_usage','developer_logins','developer_activities','productivity_sessions'] loop
  if to_regclass('public.'||tbl) is null then continue; end if;
  for row_data in execute format('select to_jsonb(t) from public.%I t where organization_id=$1 and app_private.retention_recorded(to_jsonb(t))<$2 limit $3 for update skip locked',tbl) using p_org,cutoff,p_limit loop
   if row_data->>'id' is null or app_private.retention_referenced(tbl,row_data) then skipped:=skipped+1; continue; end if;
   execute format('delete from public.%I t where organization_id=$1 and to_jsonb(t)->>''id''=$2',tbl) using p_org,row_data->>'id';
   n:=n+1;
  end loop;
 end loop;
 for row_data in select to_jsonb(s) from public.screenshots s where s.organization_id=p_org
  and app_private.retention_recorded(to_jsonb(s))<cutoff
  and not exists(select 1 from app_private.tracking_retention_files f where f.screenshot_id=s.id::text and f.status in ('processing','failed'))
  limit p_limit for update skip locked loop
  if app_private.retention_referenced('screenshots',row_data) then skipped:=skipped+1; continue; end if;
  -- Only canonical private monitoring objects have independently enforceable
  -- ownership. A mutable screenshot path cannot authorize deleting documents
  -- or legacy public-bucket bytes (even when no other record references them).
  if nullif(row_data->>'storage_path','') is null or nullif(row_data->>'developer_id','') is null
   or split_part(row_data->>'storage_path','/',1)<>p_org::text
   or split_part(row_data->>'storage_path','/',2)<>row_data->>'developer_id'
   or split_part(row_data->>'storage_path','/',3)='' then skipped:=skipped+1; continue; end if;
  -- Ambiguous paths/foreign references are preserved, never guessed.
  if exists(select 1 from public.screenshots s where s.storage_path=row_data->>'storage_path' and s.organization_id is distinct from p_org) then skipped:=skipped+1; continue; end if;
  select count(*) into refs from public.screenshots s where s.storage_path=row_data->>'storage_path';
  if refs>1 then
   delete from public.screenshots s where s.organization_id=p_org and s.id::text=row_data->>'id'; n:=n+1; continue;
  end if;
  select count(*) into matches from storage.objects o where o.name=row_data->>'storage_path' and o.bucket_id='monitoring';
  if matches=0 then
   -- No bytes exist at the canonical monitoring key; only the expired record remains.
   delete from public.screenshots s where s.organization_id=p_org and s.id::text=row_data->>'id'; n:=n+1; continue;
  end if;
  if matches<>1 then skipped:=skipped+1; continue; end if;
  select o.* into obj from storage.objects o where o.name=row_data->>'storage_path' and o.bucket_id='monitoring' for update;
  if (obj.bucket_id='monitoring' and split_part(obj.name,'/',1)<>p_org::text)
   or coalesce(obj.updated_at,obj.created_at)>=cutoff then skipped:=skipped+1; continue; end if;
  insert into app_private.tracking_retention_files(organization_id,screenshot_id,snapshot,bucket,path,object_id,object_updated_at)
   values(p_org,row_data->>'id',row_data,obj.bucket_id,obj.name,obj.id::text,obj.updated_at);
  queued:=queued+1;
 end loop;
 update public.tracking_retention_policies set last_summary=jsonb_build_object('deleted',n,'queued',queued,'skipped',skipped) where organization_id=p_org;
 return jsonb_build_object('deleted',n,'queued',queued,'skipped',skipped);
end $$;
revoke all on function public.sweep_tracking_retention(uuid,integer) from public,anon,authenticated;
grant execute on function public.sweep_tracking_retention(uuid,integer) to service_role;

commit;
