begin;
alter table public.app_usage add column ingest_revision bigint,add column ingest_payload jsonb;
alter table public.browser_usage add column ingest_revision bigint,add column ingest_payload jsonb;
-- Existing duplicates require operator reconciliation; never discard historical data.
do $$ begin
 if exists(select 1 from public.app_usage where app_name_raw is not null group by session_id,app_name_raw having count(*)>1)
  or exists(select 1 from public.browser_usage group by session_id,site having count(*)>1) then
  raise exception 'ACTIVITY_DUPLICATE_RECONCILIATION_REQUIRED: run scripts/sql/activity-aggregate-preflight.sql and reconcile duplicate keys before applying this migration';
 end if;
end $$;
create unique index if not exists app_usage_session_app_unique on public.app_usage(session_id,app_name_raw);
create unique index if not exists browser_usage_session_site_unique on public.browser_usage(session_id,site);
create function public.lock_activity_aggregate() returns uuid
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); begin
 if auth.uid() is null or org is null or auth.jwt()->'app_metadata'->>'user_type' is distinct from 'developer'
  or not coalesce(public.auth_tracker_session(),false) then raise exception 'ACTIVITY_DEVICE_REQUIRED' using errcode='42501'; end if;
 perform app_private.lock_quota(org); return org;
end $$;
revoke all on function public.lock_activity_aggregate() from public,anon,authenticated;
grant execute on function public.lock_activity_aggregate() to authenticated;

create function public.guard_activity_aggregate() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare rowdata jsonb:=to_jsonb(new); olddata jsonb; payload jsonb:=rowdata->'ingest_payload';
 rev bigint:=new.ingest_revision; canonical jsonb; allowed text[]; required text[]; key text; rowkey text;
 org uuid; stamp timestamptz; seconds numeric; minutes numeric;
begin
 if tg_op='UPDATE' then olddata:=to_jsonb(old); end if;
 if rev is null and (payload is null or payload='null'::jsonb) then
  if olddata->>'ingest_revision' is not null then raise exception 'ACTIVITY_RECEIPT_REQUIRED' using errcode='42501'; end if;
  return new; -- Legacy rows/clients remain supported until receipt enrollment.
 end if;
 org:=public.lock_activity_aggregate();
 if rev is null or rev<1 or rev>9007199254740991 or jsonb_typeof(payload) is distinct from 'object' then
  raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 allowed:=array['organization_id','user_email','user_login','session_id','duration_seconds','duration_minutes'];
 required:=array['organization_id','user_email','session_id','duration_seconds','duration_minutes'];
 if tg_table_name='app_usage' then
  allowed:=allowed||array['app_name','app_name_raw','window_title','start_time','end_time'];
  required:=required||array['app_name','app_name_raw','start_time','end_time']; rowkey:='app_name_raw';
 else
  allowed:=allowed||array['site','first_seen','last_seen'];required:=required||array['site','first_seen','last_seen'];rowkey:='site';
 end if;
 if octet_length(payload::text)>131072 or not payload ?& required or payload-allowed<>'{}'::jsonb then raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 if not coalesce(public.auth_tracker_row(rowdata),false) or payload->>'organization_id' is distinct from org::text
  or nullif(btrim(payload->>'user_email'),'') is null or lower(payload->>'user_email') is distinct from lower(auth.jwt()->>'email') then
  raise exception 'ACTIVITY_IDENTITY_MISMATCH' using errcode='42501'; end if;
 if not exists(select 1 from public.productivity_sessions s where s.session_id::text=payload->>'session_id'
  and public.auth_tracker_row(to_jsonb(s))) then raise exception 'ACTIVITY_SESSION_REQUIRED' using errcode='42501'; end if;
 foreach key in array array['user_email','session_id',rowkey] loop
  if jsonb_typeof(payload->key) is distinct from 'string' or length(btrim(payload->>key)) not between 1 and 255 then
   raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 end loop;
 if length(payload->>'session_id')>100 then raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 if tg_table_name='app_usage' and (jsonb_typeof(payload->'app_name') is distinct from 'string' or length(btrim(payload->>'app_name')) not between 1 and 255) then
  raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 foreach key in array array['user_login','window_title'] loop
  if payload ? key and payload->key<>'null'::jsonb and (jsonb_typeof(payload->key) is distinct from 'string' or length(payload->>key)>10000) then
   raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(payload->'duration_seconds') is distinct from 'number' or jsonb_typeof(payload->'duration_minutes') is distinct from 'number' then
  raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 seconds:=(payload->>'duration_seconds')::numeric; minutes:=(payload->>'duration_minutes')::numeric;
 if seconds<0 or minutes<0 or abs(minutes-seconds/60)>0.00011 then raise exception 'ACTIVITY_DURATION_INVALID' using errcode='22023'; end if;
 foreach key in array case when tg_table_name='app_usage' then array['start_time','end_time'] else array['first_seen','last_seen'] end loop
  if jsonb_typeof(payload->key) is distinct from 'string' or payload->>key !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
   raise exception 'ACTIVITY_TIMESTAMP_INVALID' using errcode='22023'; end if;
  begin stamp:=(payload->>key)::timestamptz;
  exception when others then raise exception 'ACTIVITY_TIMESTAMP_INVALID' using errcode='22023'; end;
  if not isfinite(stamp) then raise exception 'ACTIVITY_TIMESTAMP_INVALID' using errcode='22023'; end if;
 end loop;
 if tg_table_name='app_usage' then canonical:=to_jsonb(jsonb_populate_record(null::public.app_usage,payload));
 else canonical:=to_jsonb(jsonb_populate_record(null::public.browser_usage,payload)); end if;
 foreach key in array allowed loop
  if canonical->key is distinct from rowdata->key then raise exception 'ACTIVITY_RECEIPT_MISMATCH' using errcode='22023'; end if;
 end loop;
 if olddata is not null then
  if (rowdata->'organization_id',rowdata->'user_email',rowdata->'session_id',rowdata->rowkey)
   is distinct from (olddata->'organization_id',olddata->'user_email',olddata->'session_id',olddata->rowkey) then
   raise exception 'ACTIVITY_IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  if seconds<coalesce((olddata->>'duration_seconds')::numeric,0) then raise exception 'ACTIVITY_DURATION_REGRESSION' using errcode='22023'; end if;
  if olddata->>'ingest_revision' is not null then
   if rev<(olddata->>'ingest_revision')::bigint then raise exception 'ACTIVITY_REVISION_STALE' using errcode='22023'; end if;
   if rev=(olddata->>'ingest_revision')::bigint and payload is distinct from olddata->'ingest_payload' then
    raise exception 'ACTIVITY_REVISION_CONFLICT' using errcode='22023'; end if;
  end if;
 end if;
 return new;
end $$;
create trigger activity_aggregate_receipt before insert or update on public.app_usage for each row execute function public.guard_activity_aggregate();
create trigger activity_aggregate_receipt before insert or update on public.browser_usage for each row execute function public.guard_activity_aggregate();
revoke all on function public.guard_activity_aggregate() from public,anon,authenticated;

create function public.ingest_activity_aggregate(p_kind text,p_record jsonb,p_revision bigint) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare org uuid; previous jsonb; a public.app_usage%rowtype; b public.browser_usage%rowtype; label text;
begin
 org:=public.lock_activity_aggregate();
 if p_kind not in ('app','browser') or p_kind is null or jsonb_typeof(p_record) is distinct from 'object'
  or p_revision is null or p_revision not between 1 and 9007199254740991 then raise exception 'ACTIVITY_RECORD_INVALID' using errcode='22023'; end if;
 label:=p_record->>case when p_kind='app' then 'app_name_raw' else 'site' end;
 if p_kind='app' then select to_jsonb(t) into previous from public.app_usage t where t.session_id=p_record->>'session_id' and t.app_name_raw=label;
 else select to_jsonb(t) into previous from public.browser_usage t where t.session_id=p_record->>'session_id' and t.site=label; end if;
 if previous is not null and not public.auth_tracker_row(previous) then raise exception 'ACTIVITY_IDENTITY_MISMATCH' using errcode='42501'; end if;
 if previous->>'ingest_revision' is not null then
  if p_revision<(previous->>'ingest_revision')::bigint then raise exception 'ACTIVITY_REVISION_STALE' using errcode='22023'; end if;
  if p_revision=(previous->>'ingest_revision')::bigint then
   if p_record is distinct from previous->'ingest_payload' then raise exception 'ACTIVITY_REVISION_CONFLICT' using errcode='22023'; end if;
   return jsonb_build_object('kind',p_kind,'session_id',p_record->>'session_id','record_key',label,'revision',p_revision);
  end if;
 end if;
 if p_kind='app' then
  a:=jsonb_populate_record(null::public.app_usage,p_record);
  if previous is not null then
   update public.app_usage set organization_id=a.organization_id,user_email=a.user_email,user_login=a.user_login,app_name=a.app_name,
    window_title=a.window_title,start_time=a.start_time,end_time=a.end_time,duration_seconds=a.duration_seconds,
    duration_minutes=a.duration_minutes,ingest_revision=p_revision,ingest_payload=p_record
    where session_id=a.session_id and app_name_raw=a.app_name_raw;
   if not found then raise exception 'ACTIVITY_UPDATE_FORBIDDEN' using errcode='42501'; end if;
  else
  insert into public.app_usage(organization_id,user_email,user_login,session_id,app_name,app_name_raw,window_title,start_time,end_time,duration_seconds,duration_minutes,ingest_revision,ingest_payload)
  values(a.organization_id,a.user_email,a.user_login,a.session_id,a.app_name,a.app_name_raw,a.window_title,a.start_time,a.end_time,a.duration_seconds,a.duration_minutes,p_revision,p_record)
;
  end if;
 else
  b:=jsonb_populate_record(null::public.browser_usage,p_record);
  if previous is not null then
   update public.browser_usage set organization_id=b.organization_id,user_email=b.user_email,user_login=b.user_login,first_seen=b.first_seen,last_seen=b.last_seen,
    duration_seconds=b.duration_seconds,duration_minutes=b.duration_minutes,ingest_revision=p_revision,ingest_payload=p_record
    where session_id=b.session_id and site=b.site;
   if not found then raise exception 'ACTIVITY_UPDATE_FORBIDDEN' using errcode='42501'; end if;
  else
  insert into public.browser_usage(organization_id,user_email,user_login,session_id,site,first_seen,last_seen,duration_seconds,duration_minutes,ingest_revision,ingest_payload)
  values(b.organization_id,b.user_email,b.user_login,b.session_id,b.site,b.first_seen,b.last_seen,b.duration_seconds,b.duration_minutes,p_revision,p_record)
;
  end if;
 end if;
 return jsonb_build_object('kind',p_kind,'session_id',p_record->>'session_id','record_key',label,'revision',p_revision);
end $$;
revoke all on function public.ingest_activity_aggregate(text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.ingest_activity_aggregate(text,jsonb,bigint) to authenticated;
commit;
