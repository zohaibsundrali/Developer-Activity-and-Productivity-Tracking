begin;
alter table public.keyboard_stats add column capture_id uuid,add column capture_payload jsonb;
alter table public.mouse_activities add column capture_id uuid,add column capture_payload jsonb;
create unique index keyboard_capture_receipt on public.keyboard_stats(organization_id,capture_id) where capture_id is not null;
create unique index mouse_capture_receipt on public.mouse_activities(organization_id,capture_id) where capture_id is not null;
create function public.lock_input_capture() returns uuid
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); begin
 if auth.uid() is null or org is null or auth.jwt()->'app_metadata'->>'user_type' is distinct from 'developer'
  or not coalesce(public.auth_tracker_session(),false) then raise exception 'INPUT_DEVICE_REQUIRED' using errcode='42501'; end if;
 perform app_private.lock_quota(org); return org;
end $$;
revoke all on function public.lock_input_capture() from public,anon,authenticated;
grant execute on function public.lock_input_capture() to authenticated;
create function public.guard_input_capture() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare data jsonb:=to_jsonb(new); payload jsonb:=new.capture_payload; canonical jsonb; allowed text[];
 numbers text[]; key text; item jsonb; val numeric; stamp timestamptz; org uuid;
begin
 if tg_op='UPDATE' and old.capture_id is not null then
  if to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'INPUT_CAPTURE_IMMUTABLE' using errcode='42501'; end if;
  return new;
 end if;
 if new.capture_id is null and payload is null then return new; end if;
 org:=public.lock_input_capture();
 if new.capture_id is null or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>131072 then
  raise exception 'INPUT_PAYLOAD_INVALID' using errcode='22023'; end if;
 allowed:=array['organization_id','session_id','developer_id'];
 if tg_table_name='keyboard_stats' then
  numbers:=array['activity_score','keyboard_activity_percentage','active_time_minutes','idle_time_minutes','total_time_minutes','total_keys','unique_keys','words_per_minute'];
  allowed:=allowed||numbers||array['user_email','per_minute_summary','tracked_at'];
 else
  numbers:=array['active_percentage','idle_percentage'];
  allowed:=allowed||numbers||array['developer_name','timestamp','activity_status'];
 end if;
 if not payload ?& allowed or payload-allowed<>'{}'::jsonb then raise exception 'INPUT_PAYLOAD_INVALID' using errcode='22023'; end if;
 if not coalesce(public.auth_tracker_row(data),false) or payload->>'organization_id' is distinct from org::text
  or payload->>'developer_id' is distinct from public.auth_app_user_id()::text then
  raise exception 'INPUT_IDENTITY_MISMATCH' using errcode='42501'; end if;
 if jsonb_typeof(payload->'session_id') is distinct from 'string' or length(payload->>'session_id') not between 1 and 100 then
  raise exception 'INPUT_PAYLOAD_INVALID' using errcode='22023'; end if;
 if not exists(select 1 from public.productivity_sessions s where s.session_id::text=payload->>'session_id' and public.auth_tracker_row(to_jsonb(s))) then
  raise exception 'INPUT_SESSION_REQUIRED' using errcode='42501'; end if;
 foreach key in array numbers loop
  if jsonb_typeof(payload->key) is distinct from 'number' or (payload->>key)::numeric<0 then raise exception 'INPUT_METRICS_INVALID' using errcode='22023'; end if;
 end loop;
 if tg_table_name='keyboard_stats' then
  if jsonb_typeof(payload->'user_email') is distinct from 'string' or length(payload->>'user_email') not between 1 and 255
   or lower(payload->>'user_email') is distinct from lower(auth.jwt()->>'email') then raise exception 'INPUT_IDENTITY_MISMATCH' using errcode='42501'; end if;
  if (payload->>'activity_score')::numeric>100 or (payload->>'keyboard_activity_percentage')::numeric>100
   or abs((payload->>'total_time_minutes')::numeric-(payload->>'active_time_minutes')::numeric-(payload->>'idle_time_minutes')::numeric)>0.02
   or (payload->>'unique_keys')::numeric>(payload->>'total_keys')::numeric
   or (payload->>'total_keys')::numeric<>trunc((payload->>'total_keys')::numeric)
   or (payload->>'unique_keys')::numeric<>trunc((payload->>'unique_keys')::numeric) then raise exception 'INPUT_METRICS_INVALID' using errcode='22023'; end if;
  if jsonb_typeof(payload->'per_minute_summary') is distinct from 'array' or jsonb_array_length(payload->'per_minute_summary')>2000 then raise exception 'INPUT_SUMMARY_INVALID' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(payload->'per_minute_summary') loop
   if jsonb_typeof(item) is distinct from 'object' or not item ? 'Minute'
    or item-array['Minute','Key Presses','Unique Keys','WPM','Active Seconds','Idle Seconds','Active %','Special Keys','Backspaces','Key Combos','Avg Key Duration']<>'{}'::jsonb
    or jsonb_typeof(item->'Minute') is distinct from 'string' or item->>'Minute' !~ '^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d$' then raise exception 'INPUT_SUMMARY_INVALID' using errcode='22023'; end if;
   for key in select jsonb_object_keys(item-'Minute') loop
    if jsonb_typeof(item->key) is distinct from 'number' or (item->>key)::numeric<0 or (key='Active %' and (item->>key)::numeric>100) then raise exception 'INPUT_SUMMARY_INVALID' using errcode='22023'; end if;
   end loop;
  end loop;
  key:='tracked_at';
 else
  if jsonb_typeof(payload->'developer_name') is distinct from 'string' or length(payload->>'developer_name')>255
   or payload->>'activity_status' not in ('very_active','active','idle','away')
   or jsonb_typeof(payload->'activity_status') is distinct from 'string'
   or (payload->>'active_percentage')::numeric>100 or (payload->>'idle_percentage')::numeric>100
   or (payload->>'active_percentage')::numeric+(payload->>'idle_percentage')::numeric>100.0001 then raise exception 'INPUT_METRICS_INVALID' using errcode='22023'; end if;
  key:='timestamp';
 end if;
 if jsonb_typeof(payload->key) is distinct from 'string' or payload->>key !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then raise exception 'INPUT_TIMESTAMP_INVALID' using errcode='22023'; end if;
 begin stamp:=(payload->>key)::timestamptz; exception when others then raise exception 'INPUT_TIMESTAMP_INVALID' using errcode='22023'; end;
 if not isfinite(stamp) then raise exception 'INPUT_TIMESTAMP_INVALID' using errcode='22023'; end if;
 if tg_table_name='keyboard_stats' then canonical:=to_jsonb(jsonb_populate_record(null::public.keyboard_stats,payload));
 else canonical:=to_jsonb(jsonb_populate_record(null::public.mouse_activities,payload)); end if;
 foreach key in array allowed loop
  if canonical->key is distinct from data->key then raise exception 'INPUT_RECEIPT_MISMATCH' using errcode='22023'; end if;
 end loop;
 return new;
end $$;
create trigger input_capture_receipt before insert or update on public.keyboard_stats for each row execute function public.guard_input_capture();
create trigger input_capture_receipt before insert or update on public.mouse_activities for each row execute function public.guard_input_capture();
revoke all on function public.guard_input_capture() from public,anon,authenticated;
create function public.ingest_input_capture(p_kind text,p_capture_id uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare org uuid; previous jsonb; k public.keyboard_stats%rowtype; m public.mouse_activities%rowtype;
begin
 org:=public.lock_input_capture();
 if p_kind is null or p_kind not in ('keyboard','mouse') or p_capture_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'INPUT_PAYLOAD_INVALID' using errcode='22023'; end if;
 if p_kind='keyboard' then select to_jsonb(t) into previous from public.keyboard_stats t where t.organization_id=org and t.capture_id=p_capture_id;
 else select to_jsonb(t) into previous from public.mouse_activities t where t.organization_id=org and t.capture_id=p_capture_id; end if;
 if previous is not null then
  if not coalesce(public.auth_tracker_row(previous),false) then raise exception 'INPUT_IDENTITY_MISMATCH' using errcode='42501'; end if;
  if previous->'capture_payload' is distinct from p_payload then raise exception 'INPUT_CAPTURE_CONFLICT' using errcode='22023'; end if;
 else
  if p_kind='keyboard' then
   k:=jsonb_populate_record(null::public.keyboard_stats,p_payload);
   insert into public.keyboard_stats(organization_id,session_id,developer_id,user_email,activity_score,keyboard_activity_percentage,active_time_minutes,idle_time_minutes,total_time_minutes,total_keys,unique_keys,words_per_minute,per_minute_summary,tracked_at,capture_id,capture_payload)
   values(k.organization_id,k.session_id,k.developer_id,k.user_email,k.activity_score,k.keyboard_activity_percentage,k.active_time_minutes,k.idle_time_minutes,k.total_time_minutes,k.total_keys,k.unique_keys,k.words_per_minute,k.per_minute_summary,k.tracked_at,p_capture_id,p_payload);
  else
   m:=jsonb_populate_record(null::public.mouse_activities,p_payload);
   insert into public.mouse_activities(organization_id,session_id,developer_id,developer_name,timestamp,activity_status,active_percentage,idle_percentage,capture_id,capture_payload)
   values(m.organization_id,m.session_id,m.developer_id,m.developer_name,m.timestamp,m.activity_status,m.active_percentage,m.idle_percentage,p_capture_id,p_payload);
  end if;
 end if;
 return jsonb_build_object('success',true,'kind',p_kind,'capture_id',p_capture_id,'organization_id',org,'developer_id',public.auth_app_user_id());
end $$;
revoke all on function public.ingest_input_capture(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_input_capture(text,uuid,jsonb) to authenticated;
commit;
