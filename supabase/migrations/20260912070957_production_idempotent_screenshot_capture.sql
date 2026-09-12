begin;

-- Historical captures remain untouched. Receipt metadata records the original
-- request independently of later permitted annotations on the screenshot.
alter table public.screenshots add column if not exists capture_id uuid;
alter table public.screenshots add column if not exists capture_metadata jsonb;
create unique index if not exists screenshots_org_capture_unique
  on public.screenshots(organization_id,capture_id) where capture_id is not null;

-- The INSERT RPC is invoker/RLS-bound. This argument-free helper exposes only
-- the existing quota lock for the current validated enrolled developer's org.
create or replace function public.lock_screenshot_capture() returns uuid
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private
as $$
declare org uuid:=public.auth_org();
begin
  if auth.uid() is null or org is null
    or auth.jwt()->'app_metadata'->>'user_type' is distinct from 'developer'
    or not public.auth_tracker_session() then
    raise exception 'SCREENSHOT_DEVICE_UNAUTHORIZED' using errcode='42501';
  end if;
  perform app_private.lock_quota(org);
  return org;
end; $$;
revoke all on function public.lock_screenshot_capture() from public,anon,authenticated;
grant execute on function public.lock_screenshot_capture() to authenticated;

create or replace function public.finalize_screenshot_capture(p_capture_id uuid,p_metadata jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public
as $$
declare org uuid; person uuid:=public.auth_app_user_id(); payload jsonb;
  previous public.screenshots%rowtype; object_metadata jsonb; object_bytes numeric; filename text; expected_path text; mime text;
begin
  org:=public.lock_screenshot_capture();
  if p_capture_id is null or jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception 'SCREENSHOT_METADATA_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_metadata) key where key not in (
    'organization_id','developer_id','developer_email','filename','storage_path','public_url',
    'width','height','size_kb','mime_type','app_active','is_annotated','annotation_text','timestamp')) then
    raise exception 'SCREENSHOT_METADATA_UNKNOWN_FIELD' using errcode='22023';
  end if;
  if nullif(trim(auth.jwt()->>'email'),'') is null or nullif(trim(p_metadata->>'developer_email'),'') is null
    or p_metadata->>'organization_id' is distinct from org::text
    or p_metadata->>'developer_id' is distinct from person::text
    or lower(p_metadata->>'developer_email') is distinct from lower(auth.jwt()->>'email') then
    raise exception 'SCREENSHOT_IDENTITY_MISMATCH' using errcode='42501';
  end if;
  mime:=p_metadata->>'mime_type';
  if mime not in ('image/png','image/jpeg') or mime is null then
    raise exception 'SCREENSHOT_MIME_INVALID' using errcode='22023';
  end if;
  filename:='capture_'||p_capture_id::text||case when mime='image/png' then '.png' else '.jpg' end;
  expected_path:=org::text||'/'||person::text||'/'||filename;
  if p_metadata->>'storage_path' is distinct from expected_path
    or p_metadata->>'filename' is distinct from filename or p_metadata->>'public_url' is not null then
    raise exception 'SCREENSHOT_PATH_INVALID' using errcode='22023';
  end if;
  if jsonb_typeof(p_metadata->'width') is distinct from 'number'
    or jsonb_typeof(p_metadata->'height') is distinct from 'number'
    or jsonb_typeof(p_metadata->'size_kb') is distinct from 'number'
    or (p_metadata->>'width')::numeric<=0 or (p_metadata->>'height')::numeric<=0
    or (p_metadata->>'width')::numeric<>trunc((p_metadata->>'width')::numeric)
    or (p_metadata->>'height')::numeric<>trunc((p_metadata->>'height')::numeric)
    or (p_metadata->>'size_kb')::numeric<=0 or (p_metadata->>'size_kb')::numeric>6144
    or (p_metadata->>'width')::numeric>16384 or (p_metadata->>'height')::numeric>16384
    or (p_metadata ? 'app_active' and jsonb_typeof(p_metadata->'app_active') not in ('string','null'))
    or (p_metadata ? 'annotation_text' and jsonb_typeof(p_metadata->'annotation_text') not in ('string','null'))
    or jsonb_typeof(p_metadata->'is_annotated') is distinct from 'boolean'
    or jsonb_typeof(p_metadata->'timestamp') is distinct from 'string'
    or length(coalesce(p_metadata->>'annotation_text',''))>10000 then
    raise exception 'SCREENSHOT_METADATA_INVALID' using errcode='22023';
  end if;
  if not isfinite((p_metadata->>'timestamp')::timestamptz) then
    raise exception 'SCREENSHOT_METADATA_INVALID' using errcode='22023';
  end if;
  payload:=p_metadata;
  select metadata into object_metadata from storage.objects where bucket_id='monitoring' and name=expected_path;
  if not found then
    raise exception 'SCREENSHOT_OBJECT_REQUIRED' using errcode='22023';
  end if;
  if coalesce(object_metadata->>'size','') !~ '^[0-9]+$' then
    raise exception 'SCREENSHOT_OBJECT_SIZE_INVALID' using errcode='22023';
  end if;
  object_bytes:=(object_metadata->>'size')::numeric;
  if object_bytes<=0 or object_bytes>6291456 or abs(object_bytes/1024-(p_metadata->>'size_kb')::numeric)>0.01 then
    raise exception 'SCREENSHOT_OBJECT_SIZE_INVALID' using errcode='22023';
  end if;

  -- No INSERT on replay: a confirmed last-quota capture remains acknowledgeable.
  select * into previous from public.screenshots where organization_id=org and capture_id=p_capture_id;
  if found then
    if previous.developer_id is distinct from person or previous.capture_metadata is distinct from payload
      or previous.storage_path is distinct from expected_path then
      raise exception 'SCREENSHOT_CAPTURE_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('success',true,'capture_id',p_capture_id,'storage_path',expected_path);
  end if;
  -- Explicit columns only; created_at and id keep their database defaults.
  insert into public.screenshots(organization_id,developer_id,developer_email,filename,storage_path,public_url,
    width,height,size_kb,mime_type,app_active,is_annotated,annotation_text,timestamp,capture_id,capture_metadata)
  select org,person,payload->>'developer_email',filename,expected_path,null,
    (payload->>'width')::integer,(payload->>'height')::integer,(payload->>'size_kb')::numeric,mime,
    payload->>'app_active',(payload->>'is_annotated')::boolean,payload->>'annotation_text',
    (payload->>'timestamp')::timestamptz,p_capture_id,payload;
  return jsonb_build_object('success',true,'capture_id',p_capture_id,'storage_path',expected_path);
end; $$;
revoke all on function public.finalize_screenshot_capture(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_screenshot_capture(uuid,jsonb) to authenticated;

-- A direct API update must not rewrite the idempotency identity/receipt.
create or replace function app_private.guard_screenshot_capture_receipt() returns trigger
language plpgsql set search_path=pg_catalog,public
as $$
declare claimed public.screenshots%rowtype;
begin
  if tg_op='INSERT' then
    if (new.capture_id is null) <> (new.capture_metadata is null) then
      raise exception 'SCREENSHOT_CAPTURE_RECEIPT_INVALID' using errcode='22023';
    end if;
    if new.capture_id is not null then
      claimed:=jsonb_populate_record(null::public.screenshots,new.capture_metadata);
      if row(new.organization_id,new.developer_id,new.developer_email,new.filename,new.storage_path,new.public_url,
          new.width,new.height,new.size_kb,new.mime_type,new.app_active,new.is_annotated,new.annotation_text,new.timestamp)
        is distinct from row(claimed.organization_id,claimed.developer_id,claimed.developer_email,claimed.filename,
          claimed.storage_path,claimed.public_url,claimed.width,claimed.height,claimed.size_kb,claimed.mime_type,
          claimed.app_active,claimed.is_annotated,claimed.annotation_text,claimed.timestamp) then
        raise exception 'SCREENSHOT_CAPTURE_RECEIPT_INVALID' using errcode='22023';
      end if;
    end if;
    return new;
  end if;
  if new.capture_id is distinct from old.capture_id or new.capture_metadata is distinct from old.capture_metadata
    or (old.capture_id is not null and row(new.organization_id,new.developer_id,new.storage_path,new.filename,
      new.developer_email,new.width,new.height,new.size_kb,new.mime_type,new.app_active,new.timestamp,new.public_url)
      is distinct from row(old.organization_id,old.developer_id,old.storage_path,old.filename,
      old.developer_email,old.width,old.height,old.size_kb,old.mime_type,old.app_active,old.timestamp,old.public_url)) then
    raise exception 'SCREENSHOT_CAPTURE_RECEIPT_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function app_private.guard_screenshot_capture_receipt() from public,anon,authenticated;
create trigger guard_screenshot_capture_receipt before insert or update on public.screenshots
  for each row execute function app_private.guard_screenshot_capture_receipt();
commit;
